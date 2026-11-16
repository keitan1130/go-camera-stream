# Stage 1: フロントエンドのビルド
FROM node:26-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm install --global npm@12.2.2
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: バックエンドのビルド
FROM golang:1.27-alpine AS backend-builder
WORKDIR /app
COPY go.mod go.sum* ./
RUN go mod download
COPY *.go ./
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
RUN go build -o server .

# Stage 3: 実行用コンテナ
FROM alpine:3
WORKDIR /root/
COPY --from=backend-builder /app/server .
# ポートはdocker-composeで制御するためEXPOSEは省略可能
CMD ["./server"]
