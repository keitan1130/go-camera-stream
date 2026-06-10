package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"embed"
	"encoding/json"
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

type StreamRoom struct {
	mutex         sync.RWMutex
	lastFrame     []byte
	lastFrameAt   time.Time
	lastFrameSize int
	frameCount    uint64
	cameraClients int
	obsClients    map[chan []byte]bool
}

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
	rooms      = make(map[string]*StreamRoom)
)

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

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Println("WebSocket Error:", err)
		return
	}
	defer conn.Close()

	id := getStreamID(r)
	room := getRoom(id)

	room.mutex.Lock()
	room.cameraClients++
	room.mutex.Unlock()

	fmt.Printf("[カメラ接続] ID: %s が配信を開始しました\n", id)

	defer func() {
		room.mutex.Lock()
		if room.cameraClients > 0 {
			room.cameraClients--
		}
		room.mutex.Unlock()
	}()

	for {
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			fmt.Printf("[カメラ切断] ID: %s が切断されました: %v\n", id, err)
			break
		}

		if messageType == websocket.BinaryMessage && len(payload) > 0 {
			room.mutex.Lock()
			room.lastFrame = payload
			room.lastFrameAt = time.Now()
			room.lastFrameSize = len(payload)
			room.frameCount++
			frameCount := room.frameCount
			room.mutex.Unlock()

			if frameCount == 1 || frameCount%100 == 0 {
				fmt.Printf("[フレーム受信] ID: %s count=%d size=%d bytes\n", id, frameCount, len(payload))
			}

			room.broadcast(payload)
		}
	}
}

func formatTime(t time.Time) string {
	if t.IsZero() {
		return "-"
	}
	return t.Format(time.RFC3339)
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	type roomStatus struct {
		ID            string `json:"id"`
		CameraClients int    `json:"camera_clients"`
		OBSClients    int    `json:"obs_clients"`
		FrameCount    uint64 `json:"frame_count"`
		LastFrameAt   string `json:"last_frame_at"`
		LastFrameSize int    `json:"last_frame_size"`
	}

	idFilter := strings.TrimSpace(r.URL.Query().Get("id"))
	roomsMutex.Lock()
	ids := make([]string, 0, len(rooms))
	if idFilter != "" {
		ids = append(ids, idFilter)
	} else {
		for id := range rooms {
			ids = append(ids, id)
		}
	}
	roomsMutex.Unlock()

	statuses := make([]roomStatus, 0, len(ids))
	for _, id := range ids {
		room := getRoom(id)
		room.mutex.RLock()
		statuses = append(statuses, roomStatus{
			ID:            id,
			CameraClients: room.cameraClients,
			OBSClients:    len(room.obsClients),
			FrameCount:    room.frameCount,
			LastFrameAt:   formatTime(room.lastFrameAt),
			LastFrameSize: room.lastFrameSize,
		})
		room.mutex.RUnlock()
	}

	w.Header().Set("Content-Type", "application/json")
	if idFilter != "" && len(statuses) == 1 {
		_ = json.NewEncoder(w).Encode(statuses[0])
		return
	}
	_ = json.NewEncoder(w).Encode(statuses)
}

func handleVideoStream(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "multipart/x-mixed-replace; boundary=frame")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	id := getStreamID(r)
	room := getRoom(id)

	clientChan := make(chan []byte, 100)

	room.mutex.Lock()
	room.obsClients[clientChan] = true
	frame := room.lastFrame
	lastFrameAt := room.lastFrameAt
	frameCount := room.frameCount
	cameraClients := room.cameraClients
	room.mutex.Unlock()

	fmt.Printf("[OBS接続] ID: %s の映像の視聴が開始されました camera_clients=%d frame_count=%d last_frame_at=%s\n", id, cameraClients, frameCount, formatTime(lastFrameAt))
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	defer func() {
		room.mutex.Lock()
		delete(room.obsClients, clientChan)
		room.mutex.Unlock()
		close(clientChan)
		fmt.Printf("[OBS切断] ID: %s の視聴が終了されました\n", id)
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
		flusher.Flush()
		return nil
	}

	// 最初の1枚
	if frame != nil && len(frame) > 0 {
		if err := writeFrame(frame); err != nil {
			return
		}
	}

	// 以後は更新フレームを流す
	for chunk := range clientChan {
		if len(chunk) == 0 {
			continue
		}
		if err := writeFrame(chunk); err != nil {
			break
		}
	}
}

func generateSelfSignedCert(publicHost string) (tls.Certificate, error) {
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return tls.Certificate{}, err
	}

	template := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			Organization: []string{"Local Streamer"},
		},
		NotBefore: time.Now().Add(-time.Hour),
		NotAfter:  time.Now().Add(365 * 24 * time.Hour),

		KeyUsage: x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{
			x509.ExtKeyUsageServerAuth,
		},
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

	return tls.Certificate{
		Certificate: [][]byte{derBytes},
		PrivateKey:  priv,
	}, nil
}

func loadTLSCert(publicHost string) (tls.Certificate, error) {
	certFile := os.Getenv("TLS_CERT_FILE")
	keyFile := os.Getenv("TLS_KEY_FILE")

	if certFile != "" && keyFile != "" {
		return tls.LoadX509KeyPair(certFile, keyFile)
	}

	return generateSelfSignedCert(publicHost)
}

func main() {
	appPort := os.Getenv("APP_PORT")
	if appPort == "" {
		appPort = "8080"
	}

	streamPort := os.Getenv("STREAM_PORT")
	if streamPort == "" {
		streamPort = "8081"
	}

	// 外からアクセスするIP/ホスト名を明示する
	publicHost := os.Getenv("PUBLIC_HOST")
	if publicHost == "" {
		publicHost = "127.0.0.1"
	}

	appMux := http.NewServeMux()
	streamMux := http.NewServeMux()

	subFS, err := fs.Sub(frontendFS, "frontend/dist")
	if err != nil {
		fmt.Println("Warning: frontend/dist not found. Please build frontend first.")
	} else {
		appMux.Handle("/", http.FileServer(http.FS(subFS)))
	}

	appMux.HandleFunc("/ws", handleWebSocket)
	appMux.HandleFunc("/status", handleStatus)
	streamMux.HandleFunc("/stream", handleVideoStream)
	streamMux.HandleFunc("/status", handleStatus)

	cert, err := loadTLSCert(publicHost)
	if err != nil {
		panic(err)
	}

	streamURL := fmt.Sprintf("http://%s:%s/stream?id=1", publicHost, streamPort)
	if streamPort == appPort {
		appMux.HandleFunc("/stream", handleVideoStream)
		streamURL = fmt.Sprintf("https://%s:%s/stream?id=1", publicHost, appPort)
		fmt.Println("STREAM_PORT equals APP_PORT; /stream will be served over HTTPS on the app server.")
	} else {
		go func() {
			if err := http.ListenAndServe(":"+streamPort, streamMux); err != nil {
				fmt.Println("HTTP Stream Server Error:", err)
			}
		}()
	}

	server := &http.Server{
		Addr:      ":" + appPort,
		Handler:   appMux,
		TLSConfig: &tls.Config{Certificates: []tls.Certificate{cert}},
	}

	fmt.Println("=== Server Started ===")
	fmt.Printf("iPhoneアクセス用URL例: https://%s:%s/?id=1\n", publicHost, appPort)
	fmt.Printf("OBS/ブラウザ確認用ストリームURL例: %s\n", streamURL)
	fmt.Println("======================")

	if err := server.ListenAndServeTLS("", ""); err != nil {
		panic(err)
	}
}
