# OpenChat

**An AI sales and support agent for small businesses, on every chat channel they already use — with a real human inbox behind it.**

A shop owner with a WhatsApp number and a product list should not need a developer, a
Meta Business verification, or a per-seat SaaS subscription to have a bot that answers
"how much is this?", shows the product, takes the order, and hands the chat to a human
the moment the customer asks for one.

OpenChat is that system, assembled from two mature open-source projects plus the glue
that makes them one product:

| Piece | What it is | Role here |
|-------|-----------|-----------|
| [`chatwoot/`](chatwoot) | Fork of [Chatwoot](https://github.com/chatwoot/chatwoot) | The business-facing product: signup, team inbox, conversations, contacts, the web widget, and the OpenChat admin UI we added |
| [`openclaw/`](openclaw) | Fork of [OpenClaw](https://github.com/openclaw/openclaw) | The AI gateway: runs the model, owns the messaging channels (WhatsApp via QR, Discord, Telegram, Slack, …), holds per-tenant agent memory |
| [`openchat-bridge/`](openchat-bridge) | **Ours.** Node 22 + Fastify + Postgres | The orchestrator that makes the two behave like one product: tenants, channel onboarding, the RAG knowledge base, the commerce tools, human handoff, and the reply pipeline |

Everything under `openchat-bridge/`, `deploy/`, and the `Openchat::*` / `openchat-*`
surfaces inside the two forks is the work this repository is actually about. The forks
themselves are imported upstream code (see the two `chore: import …` commits at the root
of the history) — we change them only where the product needs it.

---

## What we are trying to solve

**1. A bot that works on the customer's channel, not the vendor's.**
Most "AI chatbot" products give you a website widget and call it multi-channel. Real
customers in our target market message on WhatsApp. OpenChat connects WhatsApp by
scanning a QR code with a normal phone — no Meta Business account, no message
templates, no per-conversation fees — and the same agent also serves the web widget,
Telegram, Discord, Slack, Signal, Matrix, LINE, IRC, Mattermost, Feishu, Google Chat and
Microsoft Teams. (Official WhatsApp Cloud API and 360dialog are supported too, for
businesses that want them.)

**2. Setup by conversation, not by configuration.**
A business owner opens **Copilot** in the dashboard and types *"connect WhatsApp"* or
*"create a web widget for mystore.com"*. An admin agent, running with a small set of
authorized tools, actually performs the action — creates the inbox, starts the QR login,
returns the embed snippet. Configuration screens exist, but nobody has to find them.

**3. An agent that knows this business, not the internet.**
The owner uploads a product catalog (`.xlsx`, `.csv`, `.json`) and any documents
(policies, FAQs, hours). The bridge chunks and embeds them locally, and every customer
turn retrieves that tenant's own rows — so the bot quotes real prices and real stock, and
can show product cards in the web widget.

**4. A bot that finishes the sale.**
The agent has two commerce tools: `show_product_cards` and `create_order`. It collects
name, phone, address and variant in chat and writes the order to the database, visible
under **Settings → Orders**.

**5. Never trapping a customer with a robot.**
Every conversation lives in a real Chatwoot inbox. A human can jump in at any time; when
a human is assigned, or the customer types `/human`, the agent stops answering that
conversation. Human replies typed in Chatwoot are relayed back out to WhatsApp/Discord/etc.
automatically.

**6. One tenant's data never reaching another's.**
Each tenant gets its own agent identity, its own workspace, its own knowledge rows, and —
in `fleet` mode — its own isolated OpenClaw container with its own WhatsApp pairing and
memory. The customer-facing agent is scoped to the commerce tools only: no shell, no
filesystem.

---

## How it works

```
                                       ┌──────────────────────────────┐
  customer on WhatsApp / Telegram /    │   OpenClaw Gateway  :18789   │
  Discord / Slack / … ────────────────▶│   channels + model + agents  │
                                       └───────┬──────────────▲───────┘
                                     inbound   │              │  agent.prompt / send
                                   webhook     ▼              │
  customer on your website               ┌─────────────────────────────┐
  (Chatwoot web widget) ───────┐         │      openchat-bridge :8090  │
                               │         │  tenants · channels · RAG   │
                               │         │  handoff · orders · MCP     │
                               ▼         └───────┬──────────────▲──────┘
                    ┌──────────────────────┐     │              │
                    │   Chatwoot  :3000    │◀────┘              │
                    │ inbox · contacts ·   │  create contact,   │
                    │ dashboard · widget   │  conversation,     │
                    └──────────┬───────────┘  post reply        │
                               │                                │
                               └── AgentBot webhook ────────────┘
                                   (message_created)
```

**Inbound customer message → reply**

1. WhatsApp message arrives at the OpenClaw Gateway, which POSTs it to the bridge at
   `/webhooks/openclaw/inbound`. (Web-widget messages skip this step — they start in Chatwoot.)
2. The bridge resolves which tenant owns that channel account, then creates/reuses the
   Chatwoot contact and conversation and posts the message as **incoming**.
3. Chatwoot fires its AgentBot webhook back to the bridge at `/webhooks/chatwoot/:accountId`.
4. The bridge decides ([`handoff.ts`](openchat-bridge/src/services/handoff.ts)): skip if it's
   a private note, an outgoing message, a bot's own message, AI is switched off, or a human is
   assigned; escalate if the customer asked for a human; otherwise reply.
5. It retrieves the tenant's knowledge chunks, builds the prompt (platform `SYSTEM.md` +
   the tenant's custom prompt + retrieved context + a signed commerce action token), and
   runs the tenant's OpenClaw agent, which may call `show_product_cards` / `create_order`
   back into the bridge over MCP.
6. The reply is posted into the Chatwoot conversation **and** sent back out on the original
   channel. Generation is serialized per contact, replayed deliveries are deduped, and
   bot-vs-bot loops are cut off by turnaround speed.

**Human reply → customer**: an agent typing in Chatwoot produces an outgoing
`message_created` webhook; the bridge relays it to the right channel address.

**Signup → tenant**: creating a Chatwoot account enqueues `Openchat::ProvisionTenantJob`,
which creates the `OpenClaw` agent bot + account webhook and calls the bridge's
`POST /provision`. The bridge creates the tenant row, provisions its gateway (shared or a
dedicated fleet cell), and registers the per-tenant agent persona.

---

## Repository layout

```
openchat/
├── openchat-bridge/          ← our orchestrator (start here)
│   ├── src/routes/           HTTP: provision, webhooks, channels, knowledge, orders, settings
│   ├── src/services/         tenants, chatwoot client, openclaw client, RAG, handoff, fleet pool
│   ├── src/mcp/              commerce tools (customer agent) + admin tools (copilot)
│   └── src/sql/schema.sql    tenants, channel_links, conversation_map, knowledge_*, orders
├── chatwoot/                 ← Chatwoot fork
│   ├── app/controllers/api/v1/accounts/openchat_controller.rb
│   ├── app/controllers/api/v1/internal/openchat_tools_controller.rb
│   ├── app/services/openchat/            provisioning, bridge client, inbox provisioners
│   └── app/javascript/dashboard/routes/dashboard/
│       ├── openchat-copilot/             the Copilot page (chat-driven setup)
│       └── settings/openclaw/            knowledge base + orders pages
├── openclaw/                 ← OpenClaw fork (WhatsApp addressing, inbound dispatch, bridge notify)
├── deploy/                   docker-compose.saas.yml · k8s/ · fleet-runner/
└── index.html                throwaway page for testing the web widget locally
```

---

## Running it

### Prerequisites

- **Docker** + Docker Compose v2
- **Node.js ≥ 22** (the bridge runs TypeScript directly via `--experimental-strip-types`)
- **Ruby + pnpm** only if you want to run Chatwoot natively; the Docker path needs neither
- **[Ollama](https://ollama.com)** on the host, for embeddings and (optionally) the chat model:
  ```bash
  ollama pull nomic-embed-text     # required — knowledge base embeddings
  ollama pull qwen2.5:1.5b         # optional — a small local chat model
  ```
  A hosted model (Google Gemini, Anthropic, OpenAI…) can be used for chat instead; only the
  embedding model has to be local.
- ~8 GB RAM free, and a phone with WhatsApp if you want to test that channel.

Four processes have to be up: **OpenClaw Gateway**, **Chatwoot**, **bridge Postgres**,
**the bridge**. In that order.

---

### 1. OpenClaw Gateway (`:18789`)

Build and onboard from the fork:

```bash
cd openclaw
./scripts/docker/setup.sh          # builds the image as openclaw:local and runs onboarding
```

Onboarding writes `~/.openclaw/openclaw.json`. Pick a model provider when asked — Ollama
is detected automatically if it's running. Afterwards, confirm these keys exist:

```jsonc
{
  "gateway": { "port": 18789, "mode": "local", "auth": { "mode": "token", "token": "<your-token>" } },
  "agents":  { "defaults": { "model": { "primary": "ollama/qwen2.5:1.5b" } } },
  "plugins": { "entries": { "whatsapp": { "enabled": true } } }
}
```

Keep that `gateway.auth.token` — the bridge needs it as `OPENCLAW_GATEWAY_TOKEN`.

Run the gateway with **host networking** and the state directory mounted, and tell it where
to push inbound messages:

```bash
docker run -d --name openclaw-gateway --network host \
  -v "$HOME/.openclaw:/home/node/.openclaw" \
  -e OPENCLAW_GATEWAY_BIND=lan \
  -e OPENCHAT_BRIDGE_INBOUND_URL=http://127.0.0.1:8090/webhooks/openclaw/inbound \
  openclaw:local node openclaw.mjs gateway
```

Check it: `curl -s localhost:18789/readyz`.

> Host networking is not cosmetic. OpenClaw only grants the `operator.admin` scope (needed
> for WhatsApp QR login) to a shared-token client connecting over real loopback. A bridge
> container on a Docker bridge network arrives from `172.17.x.x` and gets its scopes
> stripped — the failure looks like `missing scope: operator.admin`.

---

### 2. Chatwoot (`:3000`)

```bash
cd chatwoot
cp .env.example .env
```

Set in `chatwoot/.env`:

```bash
SECRET_KEY_BASE=<run: openssl rand -hex 64>
FRONTEND_URL=http://localhost:3000
ENABLE_ACCOUNT_SIGNUP=true          # you need to be able to sign up

# OpenChat wiring
OPENCHAT_BRIDGE_URL=http://localhost:8090
OPENCHAT_PROVISION_SECRET=dev-provision-secret
OPENCHAT_BRIDGE_INTERNAL_SECRET=dev-bridge-internal-secret
OPENCHAT_HIDE_CAPTAIN=true          # hide Chatwoot's own unrelated AI feature
```

Then:

```bash
docker compose build
docker compose run --rm rails bundle exec rails db:chatwoot_prepare
docker compose up -d
```

Chatwoot comes up on <http://localhost:3000> (Rails, Sidekiq, Vite, Postgres, Redis,
Mailhog on `:8025` for the confirmation emails).

---

### 3. Bridge Postgres (`:5434`)

Its own database, separate from Chatwoot's. The schema is created automatically on first
boot of the bridge.

```bash
docker run -d --name openchat-bridge-postgres \
  -e POSTGRES_USER=openchat -e POSTGRES_PASSWORD=openchat -e POSTGRES_DB=openchat_bridge \
  -p 5434:5432 -v openchat_bridge_pg:/var/lib/postgresql/data \
  postgres:16
```

---

### 4. The bridge (`:8090`)

```bash
cd openchat-bridge
npm install
cp .env.example .env
```

Edit `openchat-bridge/.env`:

```bash
PORT=8090
DATABASE_URL=postgres://openchat:openchat@localhost:5434/openchat_bridge
OPENCHAT_SECRET=<32+ random chars — encrypts stored tokens; changing it invalidates them>
OPENCHAT_PROVISION_SECRET=dev-provision-secret            # must match Chatwoot's
OPENCHAT_BRIDGE_INTERNAL_SECRET=dev-bridge-internal-secret # must match Chatwoot's
CHATWOOT_BASE_URL=http://localhost:3000
OPENCHAT_BRIDGE_PUBLIC_URL=http://localhost:8090          # how OpenClaw reaches the MCP endpoints
OPENCLAW_GATEWAY_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=<gateway.auth.token from step 1>
OPENCLAW_STATE_DIR=/home/<you>/.openclaw                  # must be the paired user's state dir
OLLAMA_URL=http://127.0.0.1:11434
GATEWAY_POOL_MODE=shared
```

Start it **as your normal user, not root** — WhatsApp QR needs the device identity under
`OPENCLAW_STATE_DIR`:

```bash
npm start          # or: npm run dev   (auto-restart on save)
```

Check it: `curl -s localhost:8090/health` → `{"ok":true,"service":"openchat-bridge"}`.
The bridge logs a warning at boot if it can't find `identity/device.json` or if it is
running as root — both mean WhatsApp QR will fail later.

Prefer containers? See [`openchat-bridge/README.md`](openchat-bridge/README.md) for the
`docker-compose.dev.yml` path (host networking + live reload).

---

### 5. Use it

1. Sign up at <http://localhost:3000> (confirm the email in Mailhog at <http://localhost:8025>).
   Account creation provisions your tenant on the bridge automatically — watch the bridge log
   for `tenant.provisioned`.
2. Open **Copilot** in the sidebar and type *"connect WhatsApp"*. Scan the QR with
   **WhatsApp → Linked devices → Link a device**. The bridge creates the inbox and links it.
3. Go to **Settings → OpenClaw** (the knowledge/training page) and upload a product catalog
   (`.xlsx`/`.csv`/`.json` — one product per row, with columns like `name`, `price`,
   `description`, `image_url`, `variants`) and any documents. First upload is slow: every
   row is embedded through Ollama.
4. Message the linked WhatsApp number from another phone. The conversation appears in the
   Chatwoot inbox and the agent replies there and on WhatsApp.
5. Ask it for a product and place an order — check **Settings → Orders**.
6. Type `/human` as the customer, or assign yourself to the conversation: the bot goes
   quiet and your replies go out to WhatsApp.

For the web widget instead, ask the Copilot *"create a web widget for example.com"* and
paste the snippet it returns into your site. (`index.html` at the repo root is a scratch
test page from early development — its embedded snippet is stale, so paste the fresh one
from the dashboard over it rather than reusing it as-is.)

---

### Verify the whole loop

```bash
cd openchat-bridge
./scripts/smoke-test.sh 1 +9779800000000 "hello"
```

It injects an inbound message on the real path, then waits for the
`whatsapp.inbound → agent.reply → whatsapp.outbound.agent` events in the database and
prints a PASS/FAIL. A cold Ollama model can take ~2 minutes on the first turn.

Other quick checks:

```bash
curl -s localhost:8090/health
curl -s "localhost:8090/observability/events?limit=20" | jq        # recent agent/webhook events
curl -s localhost:8090/channels/catalog | jq '.channels[].id'      # connectable channels
```

---

## Service map

Defaults from the compose files in this repo:

| Service | Port | How it runs |
|---------|------|-------------|
| Chatwoot Rails | `3000` | Docker (`chatwoot/docker-compose.yaml`) |
| Chatwoot Vite dev server | `3036` | Docker |
| Chatwoot Postgres | `5432` | Docker |
| Chatwoot Redis | `6379` | Docker |
| Mailhog (dev email) | `8025` | Docker |
| OpenChat Bridge | `8090` | Node on the host, or Docker with `--network host` |
| Bridge Postgres | `5434` | Docker |
| OpenClaw Gateway | `18789` | Docker with `--network host` |
| Ollama | `11434` | Host |

Ports on the maintainer's machine differ where they collided with other projects
(Chatwoot Postgres `5435`, Redis `6381`) — see
[`.cursor/rules/local-dev-services.mdc`](.cursor/rules/local-dev-services.mdc). If you
change them, change `DATABASE_URL` and the Chatwoot `.env` to match.

---

## Configuration reference

**`openchat-bridge/.env`** (full list in [`.env.example`](openchat-bridge/.env.example))

| Variable | Meaning |
|----------|---------|
| `DATABASE_URL` | Bridge Postgres |
| `OPENCHAT_SECRET` | Encrypts gateway/bot tokens at rest. Rotating it invalidates every stored token |
| `OPENCHAT_PROVISION_SECRET` | Shared with Chatwoot; guards `POST /provision` |
| `OPENCHAT_BRIDGE_INTERNAL_SECRET` | Shared with Chatwoot; sent as `X-Openchat-Bridge-Secret` when the copilot's tools call back into Rails |
| `CHATWOOT_BASE_URL` / `CHATWOOT_PLATFORM_TOKEN` | Chatwoot API access |
| `OPENCLAW_GATEWAY_URL` / `OPENCLAW_GATEWAY_TOKEN` | Shared-gateway connection (`gateway.auth.token`) |
| `OPENCLAW_STATE_DIR` | OpenClaw state holding the paired operator device — required for WhatsApp QR |
| `OPENCHAT_BRIDGE_PUBLIC_URL` | URL OpenClaw uses to reach `/mcp/commerce` and `/mcp/admin` |
| `GATEWAY_POOL_MODE` | `shared` (one gateway for everyone, dev) or `fleet` (one isolated cell per tenant) |
| `OPENCLAW_FLEET_RUNNER_IMAGE` | Image used to run `openclaw fleet` commands (see `deploy/fleet-runner/`) |
| `OLLAMA_URL` / `OPENCHAT_EMBEDDING_MODEL` | Embedding backend, default `nomic-embed-text` |
| `OPENCHAT_KNOWLEDGE_TOP_K` / `..._MAX_UPLOAD_BYTES` | Retrieval depth and upload cap |
| `RATE_LIMIT_PER_MINUTE` | Agent replies per minute per tenant (a separate, tighter loop guard applies per contact) |
| `STRIPE_WEBHOOK_SECRET` | Optional SaaS billing status webhook |

**Platform-wide agent instructions** live in `$OPENCLAW_STATE_DIR/SYSTEM.md` — outside any
tenant workspace, so only the operator can edit them. Per-tenant instructions are set in
the dashboard (stored on `tenants.custom_prompt`), and per-tenant persona files
(`SOUL.md`, `IDENTITY.md`, `AGENTS.md`, …) live in that tenant's own OpenClaw workspace.

---

## Troubleshooting

**`missing scope: operator.admin` when starting WhatsApp QR**
The bridge is not presenting the paired device identity over real loopback. Check, in order:
`OPENCLAW_STATE_DIR` points at the directory containing `identity/device.json` and
`devices/paired.json`; the bridge is running as the user that paired it (**not** `sudo`);
if the bridge is containerized it uses `--network host`.

**The bot looks connected but never answers**
Check `/observability/events` for the tenant. `webhook.decision` records why a message was
skipped (`human_assigned`, `ai_disabled`, `private_note`, `bot_sender`…). `agent.reply_failed`
means the model run failed — look at the gateway log for the provider error.

**Replies stop after a restart**
Already-linked WhatsApp accounts get their `dmPolicy` re-opened on every bridge boot; if that
pass logged a failure, the gateway was unreachable at start. Restart the bridge after the
gateway is up.

**"This WhatsApp number is already linked to another account"**
Deliberate. Two tenants sharing one number means two sessions racing the same phone, and
WhatsApp kills one of them with a 401 — silently. Unlink it from the first tenant first.

**The web widget 404s or throws on `import`**
The SDK is served through Vite as an ES module. Use the snippet Chatwoot generates now —
anything pointing at the old `/packs/js/sdk.js` is stale.

**Knowledge upload times out**
Every row is embedded one at a time through Ollama. Make sure `nomic-embed-text` is pulled
and Ollama is reachable at `OLLAMA_URL`; large spreadsheets legitimately take minutes.

---

## Development

```bash
cd openchat-bridge
npm run dev     # node --watch, restarts on save
npm test        # handoff + rate-limit unit tests
```

- The bridge runs `.ts` directly — no build step, no bundler.
- Live-reload inside Docker: `docker compose -f docker-compose.dev.yml up -d` (bind-mounts
  `src/`; the production `Dockerfile` bakes it in on purpose).
- Chatwoot: `docker compose exec rails bundle exec rails console`, and Vite hot-reloads
  the dashboard.
- OpenClaw fork: `pnpm install && pnpm build` inside `openclaw/`; its own contributor rules
  are in `openclaw/AGENTS.md`.

---

## Deployment

**Single host (current path)** — [`deploy/docker-compose.saas.yml`](deploy/docker-compose.saas.yml)
brings up bridge Postgres, the bridge, and a shared gateway. For `GATEWAY_POOL_MODE=fleet`,
the bridge must reach each tenant cell over host loopback: either run it natively on the
fleet host, or give the service `network_mode: host` (Linux). Build the fleet runner first:

```bash
docker build --build-arg BASE_IMAGE=openclaw:local -t openclaw-fleet-runner:local deploy/fleet-runner
```

Then `POST /provision` creates a dedicated cell per tenant (`openclaw fleet create oc-<accountId>`),
and `DELETE /tenants/:accountId` removes and purges it.

**Kubernetes** — [`deploy/k8s/openchat.yaml`](deploy/k8s/openchat.yaml) exists but is **not**
fleet-compatible: `openclaw fleet` manages containers on a local Docker socket and publishes
cells to host loopback only. Per-tenant isolation on k8s needs a different design (a controller
provisioning a Deployment + PVC per tenant) and is not built yet.

---

## Status

Working end to end in development: tenant provisioning, WhatsApp QR onboarding, web widget,
the Copilot setup agent, knowledge upload + retrieval, product cards, order capture, human
handoff, and the other OpenClaw channels through the generic connect flow. Not production
hardened — secrets in the examples are dev defaults, billing is a stub, and the k8s path is
unfinished.

## Licenses

`chatwoot/` keeps Chatwoot's license (MIT, with the `enterprise/` directory under Chatwoot's
own enterprise terms). `openclaw/` is MIT. Both are forks; upstream copyright stays with
their authors.
