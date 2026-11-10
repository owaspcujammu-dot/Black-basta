#!/bin/sh
# Container start-up: migrate → seed → serve. Every step is idempotent.
set -e

echo "[entrypoint] applying database migrations"
npx prisma migrate deploy --schema prisma/schema.prisma

echo "[entrypoint] seeding reference data and the admin account"
node dist/prisma/seed.js

echo "[entrypoint] starting the API"
exec node dist/src/server.js
