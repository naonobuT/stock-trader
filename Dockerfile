FROM node:20-alpine

WORKDIR /app

# 依存関係をインストール（native モジュールのビルドに必要なツールを含む）
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --omit=dev

# アプリケーションコードをコピー
COPY src/ ./src/
COPY public/ ./public/
COPY server.js ./

# 株価データを同梱（テスト: 100銘柄 / 本番: 全銘柄）
COPY stockdata/ ./stockdata/

# DB 永続化用ディレクトリ
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=3000
# STOCK_DATA_DIR は未設定 → ./stockdata/ を自動使用
# 本番で外部データを使う場合: -e STOCK_DATA_DIR=/mnt/stockdata

EXPOSE 3000

CMD ["node", "server.js"]
