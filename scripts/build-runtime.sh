#!/usr/bin/env bash
#
# Build the Geniro runtime image and push to Docker Hub.
#
# Prerequisites:
#   podman login docker.io   (or docker login)
#
# Usage:
#   ./scripts/build-runtime.sh [--no-push]
#
set -euo pipefail

IMAGE="docker.io/razumru/geniro-runtime:latest"
DOCKERFILE="apps/api/runtime.Dockerfile"
CONTEXT="apps/api"

# Resolve repo root (script lives in <root>/scripts/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

NO_PUSH=false
for arg in "$@"; do
  case "$arg" in
    --no-push) NO_PUSH=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# Prefer podman; fall back to docker
if command -v podman &>/dev/null; then
  CTR=podman
elif command -v docker &>/dev/null; then
  CTR=docker
else
  echo "Error: neither podman nor docker found in PATH" >&2
  exit 1
fi

echo "Using container CLI: $CTR"
echo "Building $IMAGE from $DOCKERFILE ..."

"$CTR" build -f "$REPO_ROOT/$DOCKERFILE" -t "$IMAGE" "$REPO_ROOT/$CONTEXT"

if [ "$NO_PUSH" = true ]; then
  echo "Built $IMAGE (push skipped due to --no-push)"
  exit 0
fi

echo "Pushing $IMAGE ..."
"$CTR" push "$IMAGE"

echo "Done. Image pushed: $IMAGE"
