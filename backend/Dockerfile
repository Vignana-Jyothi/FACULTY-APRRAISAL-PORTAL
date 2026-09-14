# ---------- Builder: full deps + TypeScript build ----------
FROM node:24-alpine AS builder

WORKDIR /app

# Install all deps (incl. dev: typescript, prisma, tsx) for building.
# Use `npm install` (not `npm ci`): the lockfile is generated on Windows and
# omits Linux/WASM optional deps (@emnapi/*), which makes `npm ci` fail here.
COPY package*.json ./
RUN npm install --no-audit --no-fund

# Copy source (schema lives at src/prisma/schema.prisma)
COPY . .

# Generate Prisma client + compile TS → dist/
RUN npx prisma generate --schema=src/prisma/schema.prisma
RUN npm run build

# Prune to production deps only (prisma CLI stays available via npx from node_modules)
RUN npm prune --omit=dev

# ---------- Runner: slim runtime + system Chromium for puppeteer ----------
FROM node:24-alpine AS runner

WORKDIR /app

# System Chromium + fonts/libs so puppeteer can render PDFs.
# Skip puppeteer's bundled download; use the OS package instead.
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      curl

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copy built app + pruned deps + prisma schema/client from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/prisma ./src/prisma
COPY --from=builder /app/package*.json ./
COPY docker-entrypoint.sh ./docker-entrypoint.sh
# Strip any CRLF (Windows checkout) and make executable
RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:5000/health || exit 1

# Entrypoint syncs schema then starts the server
ENTRYPOINT ["./docker-entrypoint.sh"]
