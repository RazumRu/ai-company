#!/bin/sh
# Custom entrypoint for the Daytona runner that installs a Docker socket proxy
# to strip --storage-opt arguments from container create requests.
#
# This is needed for DinD in Podman VMs where overlay2 on XFS doesn't properly
# support project quotas despite the mount options claiming prjquota.
#
# The standard DinD image starts dockerd with both a Unix socket and a TCP
# listener (with TLS). The Daytona runner binary connects to Docker via TCP
# (using DOCKER_TLS_CERTDIR certs), which bypasses a Unix socket proxy.
#
# To ensure ALL Docker API calls go through the proxy, we:
# 1. Start dockerd with ONLY the Unix socket (no TCP)
# 2. Move the socket, install the proxy
# 3. Unset TLS env vars so the runner falls back to the Unix socket
# 4. Start the runner

set -e

REAL_SOCK="/var/run/docker-real.sock"
PROXY_SOCK="/var/run/docker.sock"
PROXY_BIN="/opt/docker-socket-proxy"

# 1. Start Docker daemon with Unix socket ONLY (no TCP, no TLS)
#    Suppress TLS cert generation by clearing DOCKER_TLS_CERTDIR
export DOCKER_TLS_CERTDIR=
dockerd --host=unix:///var/run/docker.sock &
DOCKERD_PID=$!

# 2. Wait for the Docker daemon socket to appear
echo "[entrypoint-wrapper] Waiting for Docker daemon socket..."
for i in $(seq 1 120); do
  if [ -S "$PROXY_SOCK" ]; then
    if docker --host unix:///var/run/docker.sock info >/dev/null 2>&1; then
      break
    fi
  fi
  sleep 1
done

if ! docker --host unix:///var/run/docker.sock info >/dev/null 2>&1; then
  echo "[entrypoint-wrapper] WARNING: Docker daemon not ready after 120s, starting runner without proxy"
  exec daytona-runner
fi

echo "[entrypoint-wrapper] Docker daemon is ready, installing socket proxy..."

# 3. Move the real socket and start the proxy
mv "$PROXY_SOCK" "$REAL_SOCK"
"$PROXY_BIN" -real "$REAL_SOCK" -proxy "$PROXY_SOCK" &
PROXY_PID=$!

# Wait for proxy to be ready
sleep 1

if kill -0 "$PROXY_PID" 2>/dev/null; then
  echo "[entrypoint-wrapper] Docker socket proxy started (PID $PROXY_PID)"
  # Verify Docker still works through the proxy
  if docker info >/dev/null 2>&1; then
    echo "[entrypoint-wrapper] Proxy verified - Docker commands work through proxy"
  else
    echo "[entrypoint-wrapper] WARNING: Docker not working through proxy, restoring direct socket"
    kill "$PROXY_PID" 2>/dev/null || true
    rm -f "$PROXY_SOCK"
    mv "$REAL_SOCK" "$PROXY_SOCK"
  fi
else
  echo "[entrypoint-wrapper] WARNING: Proxy failed to start, restoring direct socket"
  rm -f "$PROXY_SOCK"
  mv "$REAL_SOCK" "$PROXY_SOCK"
fi

# 4. Ensure the runner uses Unix socket (clear TLS vars that would direct to TCP)
unset DOCKER_TLS_CERTDIR
unset DOCKER_CERT_PATH
unset DOCKER_TLS_VERIFY
unset DOCKER_HOST

# Start the runner
exec daytona-runner
