# Kasa POS sync server

A small, dependency-free Node.js server that replicates data between Kasa POS tills.
Every till keeps working offline with its own full copy of the data. When it can reach
the server, it uploads its changes and downloads everyone else's.

- **Zero npm dependencies.** Uses Node's built-in `node:sqlite` and `node:http`.
- **Multi-store.** One server can host many shops, each with its own secret key.
- **Serves the web app.** One shop PC can run the server and the POS itself, so tablets
  just open `http://<pc-address>:8787`.
- Runs on a shop PC, a Raspberry Pi, Docker, or a cloud host.

Requires **Node.js 22.13 or newer**. Node 22.5–22.12 also works if you start it with
`node --experimental-sqlite server/src/index.js`.

---

## Contents

1. [Quick start: one PC in the shop](#quick-start-one-pc-in-the-shop)
2. [Connecting tills](#connecting-tills)
3. [Stores and keys](#stores-and-keys)
4. [Docker](#docker)
5. [Raspberry Pi](#raspberry-pi)
6. [Cloud hosting (Render, Fly.io, Railway)](#cloud-hosting)
7. [HTTPS](#https)
8. [Configuration](#configuration)
9. [Backups and restore](#backups-and-restore)
10. [API reference](#api-reference)
11. [How sync works](#how-sync-works)
12. [Troubleshooting](#troubleshooting)

---

## Quick start: one PC in the shop

Run these from the project root.

```bash
# 1. (Optional) Build the web app so tablets can open the POS from this PC
npm install
npm run build

# 2. Create a store. Copy the key it prints: it is shown only once.
node server/src/index.js create-store "My Shop"

# 3. Start the server
node server/src/index.js
```

On startup the server prints the addresses it can be reached on:

```
Kasa POS sync server v1.0.0
  Listening on 0.0.0.0:8787
  Local:       http://localhost:8787
  Network:     http://192.168.1.10:8787
  Data:        /…/server/data/kasa.sqlite
  Web app:     serving /…/dist
```

Tips for a shop PC:

- **Fix the PC's address.** Give it a DHCP reservation in your router so the address
  tills use doesn't change.
- **Allow it through the firewall.** On Windows, allow Node.js on *Private* networks when
  asked, or open TCP port 8787.
- **Keep it awake.** Turn off sleep. Tills keep selling if the PC is off and catch up
  when it's back.
- **Start it automatically.** Use the systemd unit under [Raspberry Pi](#raspberry-pi) on
  Linux. On Windows, use Task Scheduler ("At startup", run `node server\src\index.js`
  in the project folder) or a service wrapper such as NSSM.

The root `package.json` also has `npm run server` and `npm run server:dev` (restarts
when files change).

## Connecting tills

Each till needs the **server address** (e.g. `http://192.168.1.10:8787`) and the
**store key**.

- **A till that already has data** (usually the first one): go to **Settings → Sync**,
  enter the address and key, test the connection, and turn sync on. Everything the till
  has recorded so far is uploaded.
- **A new till:** on the first-run setup screen, choose **Join an existing store** and
  enter the address and key. The till downloads the whole store (products, customers,
  users, settings, sales history). You can then sign in with an existing user's PIN.

Once connected, a till syncs about every 20 seconds, 1.5 seconds after each sale or edit,
and whenever it comes back online. The cloud icon in the header shows the status and how
many changes are waiting. Tap it to sync now.

You can type the address without `http://`, and a trailing `/` or `/api` is ignored.

## Stores and keys

A store is one shop's data set. Every till of that shop uses the same store key. Keys are
random 256-bit secrets. The server keeps only their SHA-256 hash, so a lost key can't be
recovered, only replaced.

```bash
node server/src/index.js create-store "Main Street"  # prints id + key
node server/src/index.js list-stores                 # ids, record counts, last activity
node server/src/index.js rotate-key <store-id>       # new key; the old one stops working
node server/src/index.js help
```

The CLI reads the same `DATA_DIR` as the server and can run while the server is running.
If you rotate a key (for example after a till is lost or stolen), enter the new key on
every remaining till under Settings → Sync.

Stores can also be managed over HTTP when `ADMIN_TOKEN` is set (see the
[admin API](#admin-api)).

## Docker

The image builds the web app and bundles it with the server. Build it **from the project
root**:

```bash
docker build -f server/Dockerfile -t kasa-server .
docker run -d --name kasa --restart unless-stopped \
  -p 8787:8787 -v kasa-data:/data -e ADMIN_TOKEN=change-me kasa-server

docker exec kasa node server/src/index.js create-store "My Shop"
docker logs -f kasa
```

The database lives in the `/data` volume. The container runs as the unprivileged `node`
user and has a health check on `/api/health`.

`docker compose` equivalent:

```yaml
services:
  kasa:
    build: { context: ., dockerfile: server/Dockerfile }
    ports: ["8787:8787"]
    environment:
      ADMIN_TOKEN: change-me
    volumes: ["kasa-data:/data"]
    restart: unless-stopped
volumes:
  kasa-data:
```

## Raspberry Pi

A Raspberry Pi 3/4/5 running 64-bit Raspberry Pi OS makes a good always-on shop server.

```bash
# Node.js 22+ (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

git clone <your-kasa-repo> ~/kasa && cd ~/kasa
npm install && npm run build   # optional: serve the POS from the Pi
node server/src/index.js create-store "My Shop"
```

Run it as a service with `/etc/systemd/system/kasa.service`:

```ini
[Unit]
Description=Kasa POS sync server
After=network-online.target
Wants=network-online.target

[Service]
User=pi
WorkingDirectory=/home/pi/kasa
Environment=PORT=8787
Environment=DATA_DIR=/home/pi/kasa-data
ExecStart=/usr/bin/node server/src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now kasa
journalctl -u kasa -f
```

If you set `DATA_DIR` in the unit, pass the same value to CLI commands, e.g.
`DATA_DIR=/home/pi/kasa-data node server/src/index.js list-stores`.

## Cloud hosting

A hosted server lets tills in different places (several branches, or a van) share one
store, and the host provides HTTPS. Any host that can run the Dockerfile and give it a
**persistent disk** will work. Three rules:

1. Mount a persistent volume and set `DATA_DIR` to it (the Docker image uses `/data`).
   Without one, data is lost on every deploy.
2. Run **exactly one instance**. SQLite is a single file, so don't autoscale or run
   replicas.
3. Set `ADMIN_TOKEN` as a secret if you want to create stores over HTTP. Otherwise use the
   host's shell to run `create-store`.

**Render:** New → Web Service → your repo, runtime *Docker*, Dockerfile path
`server/Dockerfile`, Docker build context `.`. Add a Disk mounted at `/data`. Render sets
`PORT` automatically.

**Fly.io:**

```bash
fly launch --dockerfile server/Dockerfile --no-deploy
fly volumes create kasa_data --size 1
# in fly.toml:
#   [mounts]
#     source = "kasa_data"
#     destination = "/data"
#   [http_service]
#     internal_port = 8787
fly secrets set ADMIN_TOKEN=change-me
fly deploy
fly ssh console -C 'node server/src/index.js create-store "My Shop"'
```

**Railway:** create a service from the repo, set the variable
`RAILWAY_DOCKERFILE_PATH=server/Dockerfile`, attach a Volume at `/data`, and set
`ADMIN_TOKEN`. Railway provides `PORT`.

Then create a store with the admin API:

```bash
curl -X POST https://your-app.example.com/api/admin/stores \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"My Shop"}'
```

## HTTPS

Browsers only allow some features on secure origins (`https://`, or `http://localhost`):

- installing the POS as an app (PWA) and running it offline (service worker),
- the camera barcode scanner.

So **opening the POS from `http://192.168.1.10:8787` on a tablet works for selling and
syncing, but it can't be installed or use the camera.** There is also the reverse rule:
a page loaded over HTTPS can't call a plain `http://` server on another machine (the
browser blocks it as mixed content). This applies to the POS hosted on an `https://`
site, and it can apply to the Android/iOS/desktop apps too, depending on how they are
packaged. The fix in every case is to put the sync server behind HTTPS.

[Caddy](https://caddyserver.com) does this in a few lines and renews certificates for
you. Run the Kasa server on `127.0.0.1:8787` (set `HOST=127.0.0.1`) and Caddy in front of
it, with `TRUST_PROXY=1` so logs show real client addresses.

**Public domain** (cloud VM, or a shop PC with port 443 forwarded). Caddy gets a Let's
Encrypt certificate automatically:

```caddyfile
pos.example.com {
	encode gzip
	reverse_proxy 127.0.0.1:8787
}
```

**LAN only** (no domain). Caddy issues certificates from its own local CA. Install
Caddy's root certificate (`caddy trust`, or copy
`~/.local/share/caddy/pki/authorities/local/root.crt`) on each tablet once:

```caddyfile
https://kasa.lan, https://192.168.1.10 {
	tls internal
	encode gzip
	reverse_proxy 127.0.0.1:8787
}
```

Then use `https://192.168.1.10` (or `https://kasa.lan` with a local DNS entry) as the
server address on every till.

## Configuration

All settings are environment variables.

| Variable      | Default                  | Meaning |
|---------------|--------------------------|---------|
| `PORT`        | `8787`                   | TCP port. |
| `HOST`        | `0.0.0.0`                | Interface to bind. Use `127.0.0.1` behind a reverse proxy. |
| `DATA_DIR`    | `server/data`            | Folder for `kasa.sqlite`. Created if missing. |
| `ADMIN_TOKEN` | *(unset)*                | Enables `/api/admin/*` when set. Use a long random value. |
| `STATIC_DIR`  | `dist` (project root)    | Built web app to serve. Set it empty to serve only the API. |
| `LOG`         | `1`                      | `0` turns off request logging. |
| `TRUST_PROXY` | `0`                      | `1` logs the client address from `X-Forwarded-For`. |

Built-in limits: request bodies up to 8 MB (after decompression), at most 2000 changes
per push, and pull pages of up to 5000 changes (default 1000).

## Backups and restore

All data is in one SQLite file, `DATA_DIR/kasa.sqlite`. It runs in WAL mode, so while the
server is running, `kasa.sqlite-wal` may hold recent changes too. Safe ways to back up:

```bash
# While running: a consistent snapshot (Node's built-in SQLite, no extra tools)
node -e "new (require('node:sqlite').DatabaseSync)('server/data/kasa.sqlite').exec(\"VACUUM INTO 'kasa-backup-$(date +%F).sqlite'\")"

# Or with the sqlite3 CLI
sqlite3 server/data/kasa.sqlite ".backup kasa-backup.sqlite"

# Or stop the server and copy kasa.sqlite (plus any -wal/-shm files)
```

Schedule the snapshot with cron or Task Scheduler and keep copies off the machine.

Every till also holds a full copy of its store, so the tills are backups too.

**Restoring:** stop the server, put the backup in place as `DATA_DIR/kasa.sqlite`
(delete any old `-wal`/`-shm` files), and start it again. When tills reconnect they
notice the server is behind what they've already seen. They then re-upload everything
they have and download from the start, so changes made after the backup come back from
the tills.

**Moving servers:** copy `kasa.sqlite` to the new server. Store ids and keys move with
it, so tills only need the new address.

## API reference

All endpoints are under `/api` and return JSON. Errors look like
`{ "error": "message" }` with a matching HTTP status. CORS is open to any origin
(`Access-Control-Allow-Origin: *`), because keys travel in the `Authorization` header,
not in cookies. Preflights (`OPTIONS`) return 204, and Chrome's Private Network Access
preflight is supported. Responses over 1 KB are gzip-compressed when the client sends
`Accept-Encoding: gzip`. Request bodies may be sent gzip-, deflate- or br-compressed with
`Content-Encoding`.

### Authentication

- Store endpoints: `Authorization: Bearer <store key>`. A missing or unknown key returns
  `401`.
- Admin endpoints: `Authorization: Bearer <ADMIN_TOKEN>`. Returns `401` for a wrong
  token, and `403` when `ADMIN_TOKEN` isn't configured.
- Optional `X-Device-Id: <id>` on store requests records which tills are active (shown by
  `list-stores`).

### `GET /api/health`

No auth. Returns `{ "ok": true, "service": "kasa-pos-sync", "version": "1.0.0", "time": 1727000000000 }`.

### `GET /api/store`

Checks a key and identifies the store. Tills use it for "Test connection".

```json
{ "id": "3f0c…", "name": "My Shop" }
```

### `POST /api/sync/push`

Uploads changed records.

```json
{
  "deviceId": "b6c1…",
  "changes": [
    { "table": "products", "id": "p-1", "updatedAt": 1727000000000,
      "data": { "id": "p-1", "name": "Tea", "price": 1000, "updatedAt": 1727000000000, "…": "…" } },
    { "table": "categories", "id": "c-9", "updatedAt": 1727000005000, "deleted": true,
      "data": { "id": "c-9", "deleted": true, "…": "…" } }
  ]
}
```

- `table` must be one of: `settings, users, categories, taxes, products, customers,
  suppliers, sales, stockMovements, purchases, shifts, cashMovements, customerPayments,
  heldOrders, audit`. Anything else rejects the whole request with `400`.
- `id` is a non-empty string (max 128 characters). `updatedAt` is a millisecond
  timestamp. `data` is the full record.
- **Last write wins:** a change replaces the stored record only when its `updatedAt` is
  strictly newer. Equal or older changes are counted as `stale` and ignored, so every
  till converges on the same version.
- Derived fields (`products.stock`, `customers.balance`, `customers.loyaltyPoints`) are
  removed if present.
- The whole push is one transaction. Each accepted change gets the store's next `seq`.
- Returns `400` for invalid input, and `413` if the body exceeds 8 MB or has more than
  2000 changes.

Response:

```json
{ "accepted": 1, "stale": 1, "serverTime": 1727000009000, "latestSeq": 42 }
```

### `GET /api/sync/pull?since=<seq>&limit=<n>`

Returns changes with `seq > since`, oldest first. `since` defaults to 0, and `limit`
defaults to 1000 (max 5000).

```json
{
  "changes": [
    { "table": "products", "id": "p-1", "updatedAt": 1727000000000, "seq": 41,
      "deleted": false, "data": { "id": "p-1", "name": "Tea", "…": "…" } }
  ],
  "cursor": 41,
  "hasMore": false,
  "latestSeq": 42,
  "storeId": "3f0c…",
  "serverTime": 1727000009000
}
```

Store `cursor` and pass it as `since` next time. While `hasMore` is true, fetch again
straight away. A record appears once, at its latest `seq`. If a till's cursor is greater
than `latestSeq`, the server has lost data (for example, restored from a backup), and the
till should start over from 0 and re-upload.

### Admin API

Enabled when `ADMIN_TOKEN` is set.

| Method & path | Body | Response |
|---|---|---|
| `POST /api/admin/stores` | `{ "name": "My Shop" }` | `201 { id, name, key, createdAt }`. The key is shown only here. |
| `GET /api/admin/stores` | | `{ stores: [{ id, name, createdAt, lastSeq, records, devices, lastSeen }] }` |
| `POST /api/admin/stores/:id/rotate-key` | | `{ id, name, key }`. The old key stops working. |

### Web app

Any other `GET` serves files from `STATIC_DIR`:

- MIME types are set correctly, including `.wasm` and `.webmanifest`.
- Hashed files in `assets/` are cached for a year (`immutable`). `index.html`, `sw.js`
  and the manifest are served `no-cache` so updates show up.
- ETags and gzip are used.
- Paths without an extension fall back to `index.html` (SPA).

If the app hasn't been built, `/` shows a short notice instead.

## How sync works

- Each till writes locally first and records every change in an **outbox**. The sync
  engine (`src/sync/`) pushes the outbox, then pulls changes since its cursor.
- Sales, stock movements, customer payments, cash movements and the audit log are
  **append-only ledgers**, and every document has a unique id. Two tills selling the same
  item at the same time therefore never overwrite each other. Both sales and both stock
  movements are kept.
- **Stock and customer balances are never synced.** Each till computes them from the
  ledgers: stock is the sum of stock movements, and balance and loyalty points come from
  sales and customer payments. So they always agree once the ledgers agree.
- Other records (products, customers, settings, …) use last-write-wins on `updatedAt`.
  If two tills edit the same product while offline, the later edit wins everywhere.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Can't reach the sync server" | Check the address and port, and that the server is running (`curl http://<ip>:8787/api/health`). Make sure the till is on the same network and the firewall allows port 8787. |
| "Invalid store key" | Copy the key again; it's case-sensitive. If it was rotated, use the new key. |
| "is not a Kasa sync server" | The address points to something else, such as a router page or the wrong port. |
| Works in a browser tab but not in the installed app or on an `https://` page | Mixed content: put the server behind HTTPS (see [HTTPS](#https)). |
| An edit "comes back" after syncing | Another till made a later edit. Last write wins by device clock, so keep every till's date and time set automatically. |
| `Port 8787 is already in use` | Another copy is running, or set `PORT=8788`. |
