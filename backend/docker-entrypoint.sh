#!/bin/sh
set -e

echo "[entrypoint] syncing database schema (prisma db push)..."
# db push brings an empty/behind DB in line with schema.prisma.
# No --accept-data-loss: fail loudly rather than silently drop columns/data.
npx prisma db push --schema=src/prisma/schema.prisma --accept-data-loss --skip-generate

echo "[entrypoint] starting server..."
exec node dist/app.js
