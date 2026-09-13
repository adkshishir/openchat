# OpenChat Bridge

Glue service between the Chatwoot fork (inbox + web widget) and the OpenClaw fork (WhatsApp QR login + AI agent).

## Run locally

```bash
cd openchat-bridge
npm install
cp .env.example .env
# start postgres, then:
npm start
```

## Run in Docker, dev mode (live-reload)

The production Dockerfile bakes `src/` into the image (`COPY src ./src`), so a
container built from it does **not** pick up host edits — you'd need a full
rebuild per change. For local dev, `docker-compose.dev.yml` bind-mounts
`./src` into the container instead and runs Node with `--watch`, so saving a
`.ts` file on the host restarts the running process automatically, with no
rebuild and no `docker cp`. See the comments at the top of that file for full
details (why it exists, how it differs from `deploy/docker-compose.saas.yml`,
and what it does/doesn't manage — it does not touch `openchat-bridge-postgres`,
which is expected to already be running and reachable at `localhost:5434`).

```bash
cd openchat-bridge
# one-time, or after adding/upgrading a dependency:
docker build -t openchat-bridge:latest .

# swap the currently-running container for the dev one (same name/port):
docker stop openchat-bridge && docker rm openchat-bridge
docker compose -f docker-compose.dev.yml up -d

# edit any file under src/ — watch it restart:
docker logs -f openchat-bridge

# stop dev mode:
docker compose -f docker-compose.dev.yml down
```

This is an opt-in dev path, separate from `deploy/docker-compose.saas.yml`
(the real deploy path, which still bakes source in on purpose).

Required environment:

- `DATABASE_URL` — Postgres
- `OPENCHAT_SECRET` — encryption key for stored tokens
- `CHATWOOT_BASE_URL`
- `OPENCLAW_GATEWAY_URL` / `OPENCLAW_GATEWAY_TOKEN` (shared-gateway MVP)
- `OPENCLAW_STATE_DIR` — path to OpenClaw state (`~/.openclaw`) that has the paired operator device; required for WhatsApp QR (`operator.admin`). Run the bridge as that same user — **not as root**.
- `GATEWAY_POOL_MODE=fleet` to give each tenant its own isolated `openclaw fleet` cell (own WhatsApp number, own agent memory) instead of one shared gateway for everyone

## WhatsApp QR / `missing scope: operator.admin`

OpenClaw clears unbound scopes for shared gateway tokens alone. The bridge must present the paired device identity under `OPENCLAW_STATE_DIR` (see `identity/device.json` + `devices/paired.json`), **or** connect over real host loopback with a `cli`/`cli` client — see `GATEWAY_POOL_MODE=fleet` below for why that second path is what per-tenant cells rely on. If the bridge was started with `sudo`, kill it and restart as your normal user:

```bash
sudo kill $(ss -tlnp | awk '/:8090/{print}' | grep -oP 'pid=\K[0-9]+')  # or: sudo kill <bridge-pid>
cd openchat-bridge && npm start
```

## Per-tenant isolation (`GATEWAY_POOL_MODE=fleet`)

Each tenant gets a real isolated OpenClaw instance — its own WhatsApp pairing, its own conversation/agent memory — via [`openclaw fleet`](../openclaw/docs/gateway/multi-tenant-hosting.md), instead of every tenant sharing one gateway process.

Setup:

1. Build the fleet-runner image (the gateway image + a `docker` CLI — `openclaw fleet` shells out to `docker` to create each tenant's cell container):
   ```bash
   docker build --build-arg BASE_IMAGE=${OPENCLAW_GATEWAY_IMAGE:-openclaw:local} \
     -t openclaw-fleet-runner:local ../deploy/fleet-runner
   ```
2. Set `GATEWAY_POOL_MODE=fleet` and `OPENCLAW_FLEET_RUNNER_IMAGE=openclaw-fleet-runner:local` in `.env`.
3. **Run this bridge as a native process on the same host as the Docker daemon** — not inside its own container (unless that container uses `network_mode: host`). This is not a style preference: OpenClaw's Gateway only preserves `operator.admin` for a shared-secret token when the connection is real TCP loopback (`127.0.0.1`/`::1`). Fleet publishes each cell's Gateway only to `127.0.0.1:<port>` on the host, so a bridge connecting from inside its own bridge-network container arrives at a docker-bridge address instead of loopback, and gets its scopes stripped — no amount of retrying or token rotation fixes that from the wrong network position.

Each `POST /provision` then creates a dedicated cell (`openclaw fleet create oc-<chatwootAccountId>`) and stores its own generated gateway URL/token on the tenant row; `DELETE /tenants/:accountId` removes and purges that cell's data. Fleet is single-host — see `deploy/k8s/openchat.yaml` for why this mode doesn't apply to the Kubernetes deploy path yet.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/provision` | Create tenant + gateway after Chatwoot signup |
| POST | `/webhooks/chatwoot/:accountId` | AgentBot inbound events |
| POST | `/webhooks/openclaw/inbound` | WhatsApp inbound sync |
| POST | `/tenants/:accountId/channels/whatsapp/setup/start` | Start QR login |
| GET | `/tenants/:accountId/channels/whatsapp/setup/wait` | Poll QR / connection |
| PATCH | `/tenants/:accountId/settings` | AI auto-reply toggle |
| POST | `/billing/stripe/webhook` | SaaS billing status |
| POST | `/tenants/:accountId/models/auth/start` | Proxy OpenClaw model OAuth |
| GET | `/observability/events` | Recent agent/webhook events |
