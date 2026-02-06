#!/usr/bin/env bash
set -euo pipefail

if ! command -v ollama >/dev/null 2>&1; then
  echo "❌ Ollama is not installed (or not in PATH)."
  echo "Install it from the official site: https://ollama.com/download"
  exit 1
fi

echo "Pulling model: qwen3-coder:30b"
ollama pull qwen3-coder:30b

echo "Pulling model: qwen3-embedding:4b"
ollama pull qwen3-embedding:4b

echo "Pulling model: phi3.5:3.8b-mini-instruct-q4_K_M"
ollama pull phi3.5:3.8b-mini-instruct-q4_K_M

echo "Pulling model: qwen2.5-coder:7b"
ollama pull qwen2.5-coder:7b

echo "Pulling model: qwen3-coder-next"
ollama pull qwen3-coder-next

echo "Pulling model: glm-4.7-flash"
ollama pull glm-4.7-flash

echo "Done."
