#!/bin/sh
set -e

echo "[entrypoint] syncing database schema (prisma db push)..."
# db push brings an empty/behind DB in line with schema.prisma.
# No --accept-data-loss: fail loudly rather than silently drop columns/data.
# A cleared destructive change is applied once, by hand, with the flag — see
# DEPLOYMENT.md §11 (run --rm ... --accept-data-loss). The boot path never
# carries it, so an accidental drop in a schema edit fails the deploy instead
# of wiping prod.
npx prisma db push --schema=src/prisma/schema.prisma --skip-generate

echo "[entrypoint] starting server..."
exec node dist/app.js
