package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"embed"
	"fmt"
	"io/fs"
	"math/big"
	"net"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

//go:embed frontend/dist/*
var frontendFS embed.FS

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// === 変更: 動画ストリーミング用のブロードキャスト管理 ===
var (
	streamMutex sync.RWMutex
	initChunk   []byte                  // 動画の初期化ヘッダー（一番最初の破片）
	obsClients  = make(map[chan []byte]bool) // 接続中のOBSクライアント一覧
)

// OBSクライアント全員に動画の破片を配る関数
func broadcastToOBS(chunk []byte) {
	streamMutex.RLock()
	defer streamMutex.RUnlock()
	for clientChan := range obsClients {
		// OBSの受信が遅れている場合は破棄してブロックを防ぐ（ノンブロッキング送信）
		select {
		case clientChan <- chunk:
		default:
		}
	}
}

// iPhoneから映像（WebM/MP4の破片）を受け取る処理
func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Println("WebSocket Error:", err)
		return
	}
	defer conn.Close()
	fmt.Println("カメラ(iPhone)が接続しました。ストリームを初期化します。")

	// カメラが繋がるたびにヘッダーをリセットする
	streamMutex.Lock()
	initChunk = nil
	streamMutex.Unlock()

	for {
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			fmt.Println("カメラ切断:", err)
			break
		}
		if messageType == websocket.BinaryMessage {
			streamMutex.Lock()
			// 一番最初に送られてきたデータ（ヘッダー）を保存する
			if initChunk == nil {
				initChunk = payload
				fmt.Println("動画ヘッダーを受信・保存しました")
			}
			streamMutex.Unlock()

			// 全てのOBSクライアントに破片を配信
			broadcastToOBS(payload)
		}
	}
}

// OBS等に向けて映像（動画ストリーム）を配信する処理
func handleVideoStream(w http.ResponseWriter, r *http.Request) {
	// MJPEGではなく、通常の動画ストリーミングのヘッダーを設定
	w.Header().Set("Content-Type", "video/webm") // iOSのフォールバック時でもOBSは良しなに解釈します
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Cache-Control", "no-cache")

	// このOBSクライアント専用の受信チャンネルを作成（バッファ100）
	clientChan := make(chan []byte, 100)

	streamMutex.Lock()
	obsClients[clientChan] = true
	savedHeader := initChunk
	streamMutex.Unlock()

	fmt.Println("OBSが接続しました")

	// 退出時のクリーンアップ処理
	defer func() {
		streamMutex.Lock()
		delete(obsClients, clientChan)
		streamMutex.Unlock()
		close(clientChan)
		fmt.Println("OBSが切断しました")
	}()

	// 1. まず最初に動画のヘッダー（初期情報）を送る（これがないとOBSは再生できない）
	if savedHeader != nil {
		w.Write(savedHeader)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}

	// 2. その後は、リアルタイムで届く動画の破片を流し続ける
	for chunk := range clientChan {
		_, err := w.Write(chunk)
		if err != nil {
			break // 書き込み失敗（OBS側で切断されたなど）でループ終了
		}
		// リアルタイム性を高めるためにフラッシュ（強制送信）する
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}
}

// --- 以下、証明書生成やmain関数はほぼ変更なし ---

func generateSelfSignedCert() (tls.Certificate, error) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return tls.Certificate{}, err
	}

	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{Organization: []string{"Local Streamer"}},
		NotBefore:    time.Now(),
		NotAfter:     time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}

	template.IPAddresses = []net.IP{net.ParseIP("127.0.0.1")}

	derBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		return tls.Certificate{}, err
	}

	return tls.Certificate{
		Certificate: [][]byte{derBytes},
		PrivateKey:  priv,
	}, nil
}

func main() {
	subFS, err := fs.Sub(frontendFS, "frontend/dist")
	if err != nil {
		fmt.Println("Warning: frontend/dist not found. Please build frontend first.")
	} else {
		http.Handle("/", http.FileServer(http.FS(subFS)))
	}

	http.HandleFunc("/ws", handleWebSocket)
	http.HandleFunc("/stream", handleVideoStream)

	cert, err := generateSelfSignedCert()
	if err != nil {
		panic(err)
	}

	// 1. 環境変数からそれぞれのポート番号を取得
	appPort := os.Getenv("APP_PORT")
	if appPort == "" {
		appPort = "8080"
	}

	streamPort := os.Getenv("STREAM_PORT")
	if streamPort == "" {
		streamPort = "8081"
	}

	// 2. ターミナル表示用にLAN内の自分のIPアドレスを取得する
	var localIP string
	addrs, _ := net.InterfaceAddrs()
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
			localIP = ipnet.IP.String()
			break // 最初の有効なIPを取得して抜ける
		}
	}
	if localIP == "" {
		localIP = "localhost"
	}

	// 3. OBS用のプレーンなHTTPサーバーを環境変数のポート(STREAM_PORT)で裏側で起動
	go func() {
		fmt.Printf("=== OBS用ストリームURL: http://%s:%s/stream ===\n", localIP, streamPort)
		if err := http.ListenAndServe(":"+streamPort, nil); err != nil {
			fmt.Println("HTTP Server Error:", err)
		}
	}()

	// 4. iPhone用のHTTPSサーバーを起動
	server := &http.Server{
		Addr:      ":" + appPort,
		TLSConfig: &tls.Config{Certificates: []tls.Certificate{cert}},
	}

	fmt.Println("=== Server Started ===")
	fmt.Printf("iPhoneアクセス用URL: https://%s:%s\n", localIP, appPort)
	fmt.Println("======================")

	if err := server.ListenAndServeTLS("", ""); err != nil {
		panic(err)
	}
}
