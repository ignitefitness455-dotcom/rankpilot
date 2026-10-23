# syntax=docker/dockerfile:1
# RankPilot web (Next.js standalone). Build: docker build -t rankpilot-web .
# Runs with EMBEDDED_PG=false against an external Postgres (Neon / Docker / RDS).

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_OUTPUT=standalone \
    EMBEDDED_PG=false
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    EMBEDDED_PG=false \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S rankpilot && adduser -S rankpilot -G rankpilot
COPY --from=build --chown=rankpilot:rankpilot /app/.next/standalone ./
COPY --from=build --chown=rankpilot:rankpilot /app/.next/static ./.next/static
COPY --from=build --chown=rankpilot:rankpilot /app/public ./public
USER rankpilot
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
