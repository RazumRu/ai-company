# ---------- Builder ----------
FROM node:24-alpine AS build

ENV APP_NAME="web"
WORKDIR /usr/src/app

ENV HUSKY=0

COPY . .

RUN corepack enable && \
    pnpm install --frozen-lockfile --config.confirmModulesPurge=false && \
    pnpm run build --no-cache --filter="@geniro/$APP_NAME"

# ---------- Runner ----------
FROM node:24-alpine AS run

ARG APP_VERSION=dev
ENV WEB_VERSION=${APP_VERSION}

WORKDIR /app

RUN apk add --no-cache --update curl gettext

COPY --from=build /usr/src/app/apps/web/package.json ./package.json

# Install production deps fresh (web has no workspace deps, so standalone install works)
RUN corepack enable && pnpm install --prod

COPY --from=build /usr/src/app/apps/web/dist ./dist
COPY --from=build /usr/src/app/apps/web/public ./public
COPY --from=build /usr/src/app/apps/web/vite.config.ts ./vite.config.ts
COPY --from=build /usr/src/app/apps/web/docker-entrypoint.sh ./docker-entrypoint.sh

ENV NODE_ENV=production
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 4173

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["pnpm", "start"]
