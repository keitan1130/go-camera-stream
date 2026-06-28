package main

import (
	"fmt"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v5"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type Room struct {
	clients map[*websocket.Conn]string
	mutex   sync.RWMutex
}

var (
	rooms      = make(map[string]*Room)
	roomsMutex sync.RWMutex
)

func handleWebSocket(c *echo.Context) error {
	conn, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		fmt.Println("WebSocket Upgrade Error:", err)
		return err
	}
	defer conn.Close()

	roomID := c.QueryParam("id")
	if roomID == "" {
		roomID = "default"
	}

	clientIP := c.RealIP()

	roomsMutex.Lock()
	if rooms[roomID] == nil {
		rooms[roomID] = &Room{
			clients: make(map[*websocket.Conn]string),
		}
	}
	room := rooms[roomID]
	roomsMutex.Unlock()

	room.mutex.Lock()
	room.clients[conn] = "unknown"
	room.mutex.Unlock()

	defer func() {
		room.mutex.Lock()
		role := room.clients[conn]
		delete(room.clients, conn)
		isEmpty := len(room.clients) == 0
		room.mutex.Unlock()

		fmt.Printf("[-] Disconnected: %s | from Room: %s | IP: %s\n", role, roomID, clientIP)

		if isEmpty {
			roomsMutex.Lock()
			delete(rooms, roomID)
			roomsMutex.Unlock()
		}
	}()

	for {
		var msg map[string]interface{}
		if err := conn.ReadJSON(&msg); err != nil {
			break
		}

		role, _ := msg["role"].(string)
		if role != "" {
			room.mutex.Lock()
			if room.clients[conn] == "unknown" {
				fmt.Printf("[+] Connected: %s | Room: %s | IP: %s\n", role, roomID, clientIP)
			}
			room.clients[conn] = role
			room.mutex.Unlock()
		}

		room.mutex.RLock()
		for cConn, rRole := range room.clients {
			if cConn != conn && rRole != role {
				cConn.WriteJSON(msg)
			}
		}
		room.mutex.RUnlock()
	}

	return nil
}
