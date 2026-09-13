#!/usr/bin/env bash
# openchat sync smoke test — sends a message through the same path a real
# WhatsApp message takes and verifies the full loop:
#   inbound (OpenClaw->bridge) -> Chatwoot -> bridge agent -> reply -> WhatsApp
#
# Usage:
#   ./scripts/smoke-test.sh [chatwoot_account_id] [from_phone] [text]
set -euo pipefail

cd "$(dirname "$0")/.."

ACCOUNT_ID="${1:-1}"
FROM="${2:-+9779806680725}"
TEXT="${3:-openchat smoke test $(date +%s)}"
BRIDGE="${OPENCHAT_BRIDGE_URL:-http://127.0.0.1:8090}"
DB_URL="${DATABASE_URL:-postgres://openchat:openchat@localhost:5434/openchat_bridge}"

echo "== gateway channels status =="
OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-$(grep -oP '(?<=OPENCLAW_GATEWAY_TOKEN=).*' .env)}" \
  openclaw channels status 2>&1 | sed 's/^/  /'

echo
echo "== sending inbound via ${BRIDGE}/webhooks/openclaw/inbound =="
START_TS="$(date +%s)"
curl -sS -X POST "${BRIDGE}/webhooks/openclaw/inbound" \
  -H 'Content-Type: application/json' \
  -d "{\"chatwoot_account_id\":${ACCOUNT_ID},\"channel\":\"whatsapp\",\"from\":\"${FROM}\",\"text\":\"${TEXT}\"}"
echo

echo
echo "== waiting for agent reply (Ollama cold start can take ~2min) =="
DONE=0
for i in $(seq 1 72); do
  sleep 5
  OUT="$(psql "$DB_URL" -Atc "
    SELECT string_agg(kind, E'\n')
    FROM observability_events
    WHERE created_at > to_timestamp(${START_TS})
      AND kind IN ('whatsapp.inbound','agent.reply','whatsapp.outbound.agent','agent.reply_failed')
      AND ( payload->>'to' = '${FROM}' OR (kind='whatsapp.inbound' AND payload->>'from' = '${FROM}') )")" || true
  if echo "$OUT" | grep -q 'whatsapp.outbound.agent'; then
    DONE=1
    break
  fi
  # fail fast on agent errors so we don't wait the full window
  if echo "$OUT" | grep -q 'agent.reply_failed'; then
    break
  fi
done

echo
echo "== recent events =="
psql "$DB_URL" -c "
  SELECT created_at::timestamp(0) AS at, kind,
         left(payload::text, 90) AS payload
  FROM observability_events
  WHERE created_at > now() - interval '3 minutes'
    AND kind NOT IN ('tenant.provisioned','webhook.decision')
  ORDER BY created_at ASC;"

echo
if [ "$DONE" = "1" ]; then
  echo "PASS: message was synced to Chatwoot, the agent replied, and the reply was sent to WhatsApp (${FROM})."
  echo "Check it in Chatwoot: http://localhost:3000/app/accounts/${ACCOUNT_ID}/conversations"
else
  echo "FAIL: no whatsapp.outbound.agent event was recorded within 2 minutes."
  echo "Check bridge log / chatwoot webhooks for the error." >&2
  exit 1
fi