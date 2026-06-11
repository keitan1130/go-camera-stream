package main

import (
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Room はシグナリング用の部屋を管理します
type Room struct {
	clients map[*websocket.Conn]string
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
		delete(room.clients, conn)
		isEmpty := len(room.clients) == 0
		room.mutex.Unlock()

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
			room.clients[conn] = role
			room.mutex.Unlock()
		}

		room.mutex.RLock()
		for c, rRole := range room.clients {
			if c != conn && rRole != role {
				c.WriteJSON(msg)
			}
		}
		room.mutex.RUnlock()
	}
}
