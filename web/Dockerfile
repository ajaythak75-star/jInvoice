# ── Stage 1: build React app ─────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

COPY . .
# VITE_AUTH_BASE is intentionally empty so the client calls /auth/* on the
# same origin as the Express server — no separate proxy needed.
RUN npm run build

# ── Stage 2: production image ─────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

# Install only runtime dependencies (skips electron, vite, typescript, etc.)
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --omit=dev

COPY server/ ./server/
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server/prod.mjs"]
