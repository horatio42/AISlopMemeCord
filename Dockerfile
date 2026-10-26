# syntax=docker/dockerfile:1.7
# AISlopMemeCord — one container, one port, zero external services.
FROM oven/bun:1.4-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.4-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN bun run build

FROM oven/bun:1.4-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    SLOP_DATA_DIR=/data \
    PORT=3000 \
    SLOP_HOST=0.0.0.0 \
    SLOP_STATIC_DIR=/app/dist/public
COPY --from=deps /app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY src/server ./src/server
COPY src/shared ./src/shared
COPY --from=build /app/dist ./dist
RUN mkdir -p /data/uploads /data/exports /data/logs \
    && chown -R bun:bun /data /app \
    && chmod 700 /data /data/uploads /data/exports /data/logs
USER bun
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
CMD ["bun", "run", "src/server/index.ts"]
