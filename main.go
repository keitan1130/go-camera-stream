package main

import (
	"crypto/tls"
	"embed"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"

	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"
)

//go:embed frontend/dist/*
var frontendFS embed.FS

func getLocalIP() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return "127.0.0.1"
	}
	defer conn.Close()
	return conn.LocalAddr().(*net.UDPAddr).IP.String()
}

func main() {
	appPort := os.Getenv("APP_PORT")
	if appPort == "" {
		appPort = "8080"
	}
	publicHost := getLocalIP()

	e := echo.New()

	e.Use(middleware.Recover())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
    AllowOrigins: []string{fmt.Sprintf("https://%s:%s", publicHost, appPort)},
    AllowMethods: []string{"GET", "POST", "OPTIONS"},
	}))

	subFS := echo.MustSubFS(frontendFS, "frontend/dist")
	e.StaticFS("/", subFS)

	e.GET("/ws", handleWebSocket)

	cert, err := loadTLSCert(publicHost)
	if err != nil {
		log.Fatal(err)
	}

	server := &http.Server{
		Addr:      ":" + appPort,
		Handler:   e,
		TLSConfig: &tls.Config{Certificates: []tls.Certificate{cert}},
	}

	fmt.Println("WebRTC P2P Signaling Server")
	fmt.Printf("送信側URL: https://%s:%s/?id=1&mode=camera\n", publicHost, appPort)
	fmt.Printf("受信側URL: https://%s:%s/?id=1&mode=viewer\n", publicHost, appPort)

	if err := server.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
