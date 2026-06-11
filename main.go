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

// シグナリング: 部屋（ID）ごとの接続クライアントを管理
type Room struct {
	clients map[*websocket.Conn]string // websocket接続 -> 役割("camera" or "viewer")
	mutex   sync.RWMutex
}

var (
	rooms      = make(map[string]*Room)
	roomsMutex sync.RWMutex
)

func getStreamID(r *http.Request) string {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		return "default"
	}
	return id
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Println("WebSocket Error:", err)
		return
	}
	defer conn.Close()

	roomID := getStreamID(r)

	// 部屋の取得または作成
	roomsMutex.Lock()
	if rooms[roomID] == nil {
		rooms[roomID] = &Room{
			clients: make(map[*websocket.Conn]string),
		}
	}
	room := rooms[roomID]
	roomsMutex.Unlock()

	// 接続を部屋に登録
	room.mutex.Lock()
	room.clients[conn] = "unknown"
	room.mutex.Unlock()

	// 切断時の処理
	defer func() {
		room.mutex.Lock()
		delete(room.clients, conn)
		isEmpty := len(room.clients) == 0
		room.mutex.Unlock()

		if isEmpty {
			roomsMutex.Lock()
			delete(rooms, roomID)
			roomsMutex.Unlock()
		}
	}()

	// メッセージの受信と中継（シグナリング）
	for {
		var msg map[string]interface{}
		if err := conn.ReadJSON(&msg); err != nil {
			break
		}

		// 初回メッセージでRole(役割)を登録
		role, _ := msg["role"].(string)
		if role != "" {
			room.mutex.Lock()
			room.clients[conn] = role
			room.mutex.Unlock()
		}

		// 同じ部屋の「自分以外」かつ「違う役割（カメラ⇔視聴者）」のクライアントにメッセージを転送
		room.mutex.RLock()
		for c, rRole := range room.clients {
			if c != conn && rRole != role {
				c.WriteJSON(msg)
			}
		}
		room.mutex.RUnlock()
	}
}

// ---------------------------------------------------------
// 証明書・サーバー起動
// ---------------------------------------------------------
func generateSelfSignedCert(publicHost string) (tls.Certificate, error) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return tls.Certificate{}, err
	}
	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{Organization: []string{"Local Streamer"}},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(365 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	template.IPAddresses = []net.IP{net.ParseIP("127.0.0.1")}
	template.DNSNames = []string{"localhost"}
	if ip := net.ParseIP(publicHost); ip != nil {
		template.IPAddresses = append(template.IPAddresses, ip)
	} else if publicHost != "" {
		template.DNSNames = append(template.DNSNames, publicHost)
	}
	derBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
	if err != nil {
		return tls.Certificate{}, err
	}
	return tls.Certificate{Certificate: [][]byte{derBytes}, PrivateKey: priv}, nil
}

func loadTLSCert(publicHost string) (tls.Certificate, error) {
	if certFile := os.Getenv("TLS_CERT_FILE"); certFile != "" {
		return tls.LoadX509KeyPair(certFile, os.Getenv("TLS_KEY_FILE"))
	}
	return generateSelfSignedCert(publicHost)
}

func main() {
	appPort := os.Getenv("APP_PORT")
	if appPort == "" {
		appPort = "8080"
	}
	publicHost := os.Getenv("PUBLIC_HOST")
	if publicHost == "" {
		publicHost = "127.0.0.1"
	}

	appMux := http.NewServeMux()
	subFS, err := fs.Sub(frontendFS, "frontend/dist")
	if err != nil {
		fmt.Println("Warning: frontend/dist not found. Please build frontend first.")
	} else {
		appMux.Handle("/", http.FileServer(http.FS(subFS)))
	}

	appMux.HandleFunc("/ws", handleWebSocket)

	cert, err := loadTLSCert(publicHost)
	if err != nil {
		panic(err)
	}
	server := &http.Server{
		Addr:      ":" + appPort,
		Handler:   appMux,
		TLSConfig: &tls.Config{Certificates: []tls.Certificate{cert}},
	}

	fmt.Println("=== WebRTC P2P Signaling Server Started ===")
	fmt.Printf("カメラ用URL: https://%s:%s/?id=1\n", publicHost, appPort)
	fmt.Printf("OBSブラウザソース用URL: https://%s:%s/?id=1&mode=viewer\n", publicHost, appPort)
	fmt.Println("===========================================")

	if err := server.ListenAndServeTLS("", ""); err != nil {
		panic(err)
	}
}
