FROM node:24-alpine AS builder

WORKDIR /app

# npm install (not ci): Windows-generated lockfile omits Linux/WASM optional
# deps (Tailwind v4 oxide / lightningcss), which makes `npm ci` fail here.
COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
