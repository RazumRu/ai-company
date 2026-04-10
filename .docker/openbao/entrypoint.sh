#!/bin/sh
set -e

INIT_FILE="/openbao/init/init-result.json"

# Start server in background
bao server -config=/openbao/config &
BAO_PID=$!

# Wait for server to be reachable
echo "Waiting for OpenBao to start..."
until bao status > /dev/null 2>&1; [ $? -le 1 ]; do
  sleep 1
done

# First run: initialize and enable KV engine
if [ ! -f "$INIT_FILE" ]; then
  echo "Initializing OpenBao..."
  bao operator init -key-shares=1 -key-threshold=1 -format=json > "$INIT_FILE"

  UNSEAL_KEY=$(cat "$INIT_FILE" | grep -o '"unseal_keys_b64":\["[^"]*"' | sed 's/.*\["//' | sed 's/".*//')
  ROOT_TOKEN=$(cat "$INIT_FILE" | grep -o '"root_token":"[^"]*"' | sed 's/.*":"//' | sed 's/".*//')

  bao operator unseal "$UNSEAL_KEY"

  export BAO_TOKEN="$ROOT_TOKEN"
  bao secrets enable -path=secret -version=2 kv
  echo "OpenBao initialized and KV v2 engine enabled."
else
  echo "OpenBao already initialized, unsealing..."
  UNSEAL_KEY=$(cat "$INIT_FILE" | grep -o '"unseal_keys_b64":\["[^"]*"' | sed 's/.*\["//' | sed 's/".*//')
  ROOT_TOKEN=$(cat "$INIT_FILE" | grep -o '"root_token":"[^"]*"' | sed 's/.*":"//' | sed 's/".*//')

  bao operator unseal "$UNSEAL_KEY"
fi

echo "ROOT_TOKEN=$ROOT_TOKEN" > /openbao/init/env.sh
echo "OpenBao is ready."

# Bring server back to foreground
wait $BAO_PID
