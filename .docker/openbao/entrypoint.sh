#!/bin/sh

INIT_FILE="/openbao/init/init-result.json"

# Start server in background
bao server -config=/openbao/config &
BAO_PID=$!

# Wait for server HTTP listener to be ready
# /v1/sys/health returns 501 when uninitialized, but any HTTP response means the server is up
echo "Waiting for OpenBao to start..."
while ! wget -q -S --timeout=1 -O /dev/null "$BAO_ADDR/v1/sys/health" 2>&1 | grep -q "HTTP/"; do
  sleep 1
done
echo "OpenBao server is reachable."

# Extract unseal key and root token from init JSON (handles pretty-printed output)
extract_keys() {
  UNSEAL_KEY=$(grep -A1 '"unseal_keys_b64"' "$INIT_FILE" | tail -1 | sed 's/.*"\(.*\)".*/\1/')
  ROOT_TOKEN=$(grep '"root_token"' "$INIT_FILE" | sed 's/.*: *"\(.*\)".*/\1/')
}

# First run: initialize and enable KV engine
if [ ! -f "$INIT_FILE" ]; then
  echo "Initializing OpenBao..."
  bao operator init -key-shares=1 -key-threshold=1 -format=json > "$INIT_FILE"

  extract_keys
  bao operator unseal "$UNSEAL_KEY"

  # Wait for unseal to take effect
  export BAO_TOKEN="$ROOT_TOKEN"
  until bao status > /dev/null 2>&1; do sleep 1; done

  bao secrets enable -path=secret -version=2 kv
  bao token create -id="dev-openbao-token" -policy=root -ttl=0
  echo "OpenBao initialized and KV v2 engine enabled."
else
  echo "OpenBao already initialized, unsealing..."
  extract_keys
  bao operator unseal "$UNSEAL_KEY"
fi

echo "ROOT_TOKEN=$ROOT_TOKEN" > /openbao/init/env.sh
echo "OpenBao is ready."

# Bring server back to foreground
wait $BAO_PID
