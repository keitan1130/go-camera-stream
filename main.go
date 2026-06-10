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
	"time"

	"github.com/gorilla/websocket"
)

//go:embed frontend/dist/*
var frontendFS embed.FS

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Println("WebSocket Error:", err)
		return
	}
	defer conn.Close()
	fmt.Println("クライアントが接続しました")

	for {
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			fmt.Println("切断:", err)
			break
		}
		if messageType == websocket.BinaryMessage {
			// OBSやNDIへ流し込む場合はここでpayload(画像バイナリ)を処理します
			fmt.Printf("受信サイズ: %d bytes\n", len(payload))
		}
	}
}

func generateSelfSignedCert() (tls.Certificate, error) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return tls.Certificate{}, err
	}

	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{Organization: []string{"Local Streamer"}},
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
		// 開発時にdistが無い場合のエラー回避
		fmt.Println("Warning: frontend/dist not found. Please build frontend first.")
	} else {
		http.Handle("/", http.FileServer(http.FS(subFS)))
	}

	http.HandleFunc("/ws", handleWebSocket)

	cert, err := generateSelfSignedCert()
	if err != nil {
		panic(err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	server := &http.Server{
		Addr:      ":" + port,
		TLSConfig: &tls.Config{Certificates: []tls.Certificate{cert}},
	}

	fmt.Println("=== Server Started ===")
	addrs, _ := net.InterfaceAddrs()
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
			fmt.Printf("アクセスURL: https://%s:%s\n", ipnet.IP.String(), port)
		}
	}
	fmt.Println("======================")

	if err := server.ListenAndServeTLS("", ""); err != nil {
		panic(err)
	}
}
