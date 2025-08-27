FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache bash ca-certificates git curl openssh-client

RUN corepack enable
