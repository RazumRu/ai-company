#!/usr/bin/env bash
set -euo pipefail

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew not found. Install it first: https://brew.sh"
  exit 1
fi

if ! command -v ollama >/dev/null 2>&1; then
  echo "Installing Ollama..."
  brew install ollama
else
  echo "Ollama already installed."
fi

if ! pgrep -x "ollama" >/dev/null 2>&1; then
  echo "Starting Ollama..."
  nohup ollama serve >/tmp/ollama.log 2>&1 &
  sleep 2
else
  echo "Ollama is already running."
fi

echo "Pulling model: qwen3:32b-q4_K_M"
ollama pull qwen3:32b-q4_K_M

echo "Pulling model: qwen3-coder:30b"
ollama pull qwen3-coder:30b

echo "Pulling model: qwen3-embedding:4b"
ollama pull qwen3-embedding:4b

echo "Done."
