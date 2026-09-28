# The admin dashboard. Two homes, one image recipe:
# - Render (render.yaml): served at the root, relays /api/v1/admin/* to the
#   EC2 API over HTTPS with the pinned certificate (API_SERVER_URL).
# - The EC2 API box, beside the old dashboard: built with
#   --build-arg BASE_PATH=/v2; nginx sends /v2/... here and it relays to the
#   API container over the private Docker network.
FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Build-time: the sub-path nginx serves this under (see next.config.ts).
ARG BASE_PATH=
ENV BASE_PATH=$BASE_PATH
RUN NODE_OPTIONS=--max-old-space-size=1024 npx next build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/certs ./certs
USER node
EXPOSE 3000
# Render sets PORT itself; the base path is baked in at build time.
ARG BASE_PATH=
ENV BASE_PATH=$BASE_PATH
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- "http://127.0.0.1:${PORT}${BASE_PATH}/health" >/dev/null || exit 1
CMD ["node", "server.js"]
