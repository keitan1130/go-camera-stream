package main

import (
	"crypto/tls"
	"embed"
	"fmt"
	"io/fs"
	"net/http"
	"os"
)

//go:embed frontend/dist/*
var frontendFS embed.FS

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
