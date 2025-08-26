FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache ca-certificates git curl
RUN corepack enable
