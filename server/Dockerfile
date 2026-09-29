# syntax=docker/dockerfile:1
# OpenPOS sync server + web app in one image.
# Build from the PROJECT ROOT (the web app is built in the first stage):
#   docker build -f server/Dockerfile -t openpos-server .
#   docker run -d --name openpos -p 8787:8787 -v openpos-data:/data -e ADMIN_TOKEN=change-me openpos-server
#   docker exec openpos node server/src/index.js create-store "My Shop"

# ---- 1. Build the web app (dist/) ------------------------------------------
FROM node:24-alpine AS web
WORKDIR /src
COPY package.json package-lock.json ./
# --ignore-scripts skips Electron/Playwright binary downloads, which the web build doesn't need.
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN npx vite build

# ---- 2. Runtime: Node + server source + built app (no npm dependencies) ----
FROM node:24-alpine
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DATA_DIR=/data
WORKDIR /app
COPY server/package.json server/package.json
COPY server/src server/src
COPY --from=web /src/dist dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
STOPSIGNAL SIGTERM
CMD ["node", "server/src/index.js"]
