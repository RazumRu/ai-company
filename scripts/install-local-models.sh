#!/usr/bin/env bash
set -euo pipefail

if ! command -v ollama >/dev/null 2>&1; then
  echo "❌ Ollama is not installed (or not in PATH)."
  echo "Install it from the official site: https://ollama.com/download"
  exit 1
fi

echo "Pulling model: qwen3:32b-q4_K_M"
ollama pull qwen3:32b-q4_K_M

echo "Pulling model: qwen3-coder:30b"
ollama pull qwen3-coder:30b

echo "Pulling model: qwen3-embedding:4b"
ollama pull qwen3-embedding:4b

echo "Done."
