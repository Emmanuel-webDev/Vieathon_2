# Long-running Node host (Railway / Fly.io). node:sqlite needs Node >= 22.13.
FROM node:22.14-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --maxsockets=5
COPY . .
# NEXT_PUBLIC_* values are inlined at build time; pass them as build args.
ARG NEXT_PUBLIC_EAS_SCHEMA_UID="0x0c57cb369bf451ea40118e367beb29e6f23c8e0913b29058287337a86237e5c3"
ARG NEXT_PUBLIC_WC_PROJECT_ID=""
ENV NEXT_PUBLIC_EAS_SCHEMA_UID=$NEXT_PUBLIC_EAS_SCHEMA_UID \
    NEXT_PUBLIC_WC_PROJECT_ID=$NEXT_PUBLIC_WC_PROJECT_ID \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM node:22.14-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    NIGHTWATCH_WORKER=1 \
    NODE_OPTIONS=--dns-result-order=ipv4first
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/next.config.mjs ./
RUN mkdir -p /data /app/data && chown -R node:node /data /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "npx next start -H 0.0.0.0 -p ${PORT:-3000}"]
