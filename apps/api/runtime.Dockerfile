FROM node:22

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

RUN apt-get update -y && apt-get install -y --no-install-recommends \
  ca-certificates git curl openssh-client \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
