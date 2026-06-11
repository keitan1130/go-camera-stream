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
	"github.com/pion/webrtc/v3"
)

//go:embed frontend/dist/*
var frontendFS embed.FS

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// SFU: 部屋ごとの映像トラックを保持
var (
	tracks   = make(map[string]*webrtc.TrackLocalStaticRTP)
	sfuMutex sync.RWMutex
)

// シグナリング用メッセージ
type SignalingMsg struct {
	Role      string                     `json:"role"`
	Type      string                     `json:"type"`
	SDP       *webrtc.SessionDescription `json:"sdp,omitempty"`
	Candidate *webrtc.ICECandidateInit   `json:"candidate,omitempty"`
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

	roomID := getStreamID(r)
	var pc *webrtc.PeerConnection

	// STUNサーバーの設定
	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{{URLs: []string{"stun:stun.l.google.com:19302"}}},
	}

	for {
		var msg SignalingMsg
		if err := conn.ReadJSON(&msg); err != nil {
			break
		}

		if msg.Type == "offer" {
			pc, err = webrtc.NewPeerConnection(config)
			if err != nil {
				continue
			}

			// 経路候補(ICE)が見つかったら相手に送り返す
			pc.OnICECandidate(func(c *webrtc.ICECandidate) {
				if c == nil {
					return
				}
				jsonCandidate := c.ToJSON()
				conn.WriteJSON(SignalingMsg{Type: "candidate", Candidate: &jsonCandidate})
			})

			if msg.Role == "camera" {
				fmt.Printf("[SFU] ID: %s のカメラが接続しました\n", roomID)

				// カメラから送られてきた映像を受け取る処理
				pc.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
					sfuMutex.Lock()
					localTrack, _ := webrtc.NewTrackLocalStaticRTP(track.Codec().RTPCodecCapability, "video", "pion")
					tracks[roomID] = localTrack
					sfuMutex.Unlock()

					// 受信したパケットをそのまま中継用トラックへ流し込む
					rtpBuf := make([]byte, 1500)
					for {
						i, _, readErr := track.Read(rtpBuf)
						if readErr != nil {
							break
						}
						sfuMutex.RLock()
						if t, ok := tracks[roomID]; ok && t != nil {
							t.Write(rtpBuf[:i])
						}
						sfuMutex.RUnlock()
					}
				})

			} else if msg.Role == "viewer" {
				fmt.Printf("[SFU] ID: %s の視聴者が接続しました\n", roomID)

				// 視聴者には保存されているカメラトラックを渡す
				sfuMutex.RLock()
				if t, ok := tracks[roomID]; ok && t != nil {
					pc.AddTrack(t)
				}
				sfuMutex.RUnlock()
			}

			// Offerに対するAnswerを作成して返す
			pc.SetRemoteDescription(*msg.SDP)
			answer, _ := pc.CreateAnswer(nil)
			pc.SetLocalDescription(answer)
			conn.WriteJSON(SignalingMsg{Type: "answer", SDP: &answer})

		} else if msg.Type == "candidate" && pc != nil {
			pc.AddICECandidate(*msg.Candidate)
		}
	}

	if pc != nil {
		pc.Close()
	}
}

// ---------------------------------------------------------
// 証明書・サーバー起動（変更なし）
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

	// エンドポイントは WebSocket 用の /ws のみ
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

	fmt.Println("=== WebRTC SFU Server Started ===")
	fmt.Printf("カメラ用URL: https://%s:%s/?id=1\n", publicHost, appPort)
	fmt.Printf("OBSブラウザソース用URL: https://%s:%s/?id=1&mode=viewer\n", publicHost, appPort)
	fmt.Println("=================================")

	if err := server.ListenAndServeTLS("", ""); err != nil {
		panic(err)
	}
}
