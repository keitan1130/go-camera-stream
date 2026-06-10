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
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

//go:embed frontend/dist/*
var frontendFS embed.FS

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// === 拡張: IDごとに映像ストリームを管理する構造体 ===
type StreamRoom struct {
	mutex      sync.RWMutex
	lastFrame  []byte                  // 最後に受信したJPEGフレーム
	obsClients map[chan []byte]bool // その部屋に繋がっているOBS一覧
}

// その部屋の全OBSに映像を配るメソッド
func (r *StreamRoom) broadcast(chunk []byte) {
	r.mutex.RLock()
	defer r.mutex.RUnlock()
	for clientChan := range r.obsClients {
		select {
		case clientChan <- chunk:
		default:
		}
	}
}

var (
	roomsMutex sync.Mutex
	rooms      = make(map[string]*StreamRoom) // IDごとの部屋を保持するマップ
)

// 指定されたIDの部屋を取得、なければ自動作成するヘルパー関数
func getRoom(id string) *StreamRoom {
	roomsMutex.Lock()
	defer roomsMutex.Unlock()

	if room, exists := rooms[id]; exists {
		return room
	}

	newRoom := &StreamRoom{
		obsClients: make(map[chan []byte]bool),
	}
	rooms[id] = newRoom
	return newRoom
}

func getStreamID(r *http.Request) string {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		return "default"
	}
	return id
}

// iPhoneから映像を受け取る処理
func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Println("WebSocket Error:", err)
		return
	}
	defer conn.Close()

	id := getStreamID(r)
	room := getRoom(id)

	fmt.Printf("[カメラ接続] ID: %s が配信を開始しました\n", id)

	for {
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			fmt.Printf("[カメラ切断] ID: %s が切断されました\n", id)
			break
		}
		if messageType == websocket.BinaryMessage {
			room.mutex.Lock()
			room.lastFrame = payload
			room.mutex.Unlock()

			// この部屋のOBSだけに映像を分配
			room.broadcast(payload)
		}
	}
}

// OBS等に向けて映像を配信する処理
func handleVideoStream(w http.ResponseWriter, r *http.Request) {

	fmt.Println("STREAM REQUEST RECEIVED")

	w.Header().Set("Content-Type", "multipart/x-mixed-replace; boundary=frame")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	id := getStreamID(r)
	room := getRoom(id)

	clientChan := make(chan []byte, 100)

	room.mutex.Lock()
	room.obsClients[clientChan] = true
	frame := room.lastFrame
	room.mutex.Unlock()

	fmt.Printf("[OBS接続] ID: %s の映像の視聴が開始されました\n", id)

	defer func() {
		room.mutex.Lock()
		delete(room.obsClients, clientChan)
		room.mutex.Unlock()
		close(clientChan)
		fmt.Printf("[OBS切断] ID: %s の視聴が終了しました\n", id)
	}()

	writeFrame := func(img []byte) error {
		header := fmt.Sprintf("--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n", len(img))
		if _, err := w.Write([]byte(header)); err != nil {
			return err
		}
		if _, err := w.Write(img); err != nil {
			return err
		}
		if _, err := w.Write([]byte("\r\n")); err != nil {
			return err
		}
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		return nil
	}

	// 最初に最新フレームがあれば送信
	if frame != nil {
		if err := writeFrame(frame); err != nil {
			return
		}
	}

	// 以降、チャンネルから届くフレームを送信
	for chunk := range clientChan {
		if err := writeFrame(chunk); err != nil {
			break
		}
	}
}

// --- 以下、main関数や証明書生成はそのまま ---

func generateSelfSignedCert(localIP string) (tls.Certificate, error) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return tls.Certificate{}, err
	}

	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			Organization: []string{"Local Streamer"},
		},
		NotBefore: time.Now(),
		NotAfter:  time.Now().Add(365 * 24 * time.Hour),
		KeyUsage: x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}

	template.IPAddresses = []net.IP{net.ParseIP("127.0.0.1")}
	if ip := net.ParseIP(localIP); ip != nil {
		template.IPAddresses = append(template.IPAddresses, ip)
	}

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

	appPort := os.Getenv("APP_PORT")
	if appPort == "" {
		appPort = "8080"
	}

	streamPort := os.Getenv("STREAM_PORT")
	if streamPort == "" {
		streamPort = "8081"
	}

	var localIP string
	addrs, _ := net.InterfaceAddrs()
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
			localIP = ipnet.IP.String()
			break
		}
	}
	if localIP == "" {
		localIP = "127.0.0.1"
	}

	cert, err := generateSelfSignedCert(localIP)
	if err != nil {
		panic(err)
	}

	go func() {
		fmt.Printf("=== OBS用ストリームURL例: http://%s:%s/stream?id=1 ===\n", localIP, streamPort)
		if err := http.ListenAndServe(":"+streamPort, nil); err != nil {
			fmt.Println("HTTP Server Error:", err)
		}
	}()

	server := &http.Server{
		Addr:      ":" + appPort,
		TLSConfig: &tls.Config{Certificates: []tls.Certificate{cert}},
	}

	fmt.Println("=== Server Started ===")
	fmt.Printf("iPhoneアクセス用URL例: https://%s:%s/?id=1\n", localIP, appPort)
	fmt.Println("======================")

	if err := server.ListenAndServeTLS("", ""); err != nil {
		panic(err)
	}
}
