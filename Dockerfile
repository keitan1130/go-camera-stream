# Stage 1: フロントエンドのビルド
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: バックエンドのビルド
FROM golang:1.22-alpine AS backend-builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY main.go ./
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
RUN go build -o server main.go

# Stage 3: 実行用コンテナ
FROM alpine:latest
WORKDIR /root/
COPY --from=backend-builder /app/server .
# ポートはdocker-composeで制御するためEXPOSEは省略可能
CMD ["./server"]
