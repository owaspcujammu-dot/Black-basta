# Build context: the repository root (see docker-compose.yml).
FROM node:22-bookworm-slim AS base
# openssl is needed by the Prisma schema engine (`prisma migrate deploy`).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── build: compile TypeScript ────────────────────────────────────────────────
FROM base AS build
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace backend --include-workspace-root
COPY backend backend
RUN npm run build --workspace backend

# ── runtime: production dependencies only ────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace backend --omit=dev && npm cache clean --force
COPY backend/prisma backend/prisma
RUN npx prisma generate --schema backend/prisma/schema.prisma
COPY --from=build /app/backend/dist backend/dist
COPY backend/docker-entrypoint.sh backend/docker-entrypoint.sh
RUN sed -i 's/\r$//' backend/docker-entrypoint.sh \
  && chmod +x backend/docker-entrypoint.sh \
  && mkdir -p /app/uploads \
  && chown -R node:node /app/uploads

# Never run the server as root.
USER node
WORKDIR /app/backend
EXPOSE 5000
ENTRYPOINT ["./docker-entrypoint.sh"]
