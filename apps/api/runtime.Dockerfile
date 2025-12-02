FROM node:22

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

RUN apt-get update -y && apt-get install -y --no-install-recommends \
  ca-certificates \
  git \
  curl \
  openssh-client \
  python3 \
  python3-pip \
  python3-venv \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
