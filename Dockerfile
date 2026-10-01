# vibld under Docker, with no Cloudflare account (docs/decisions.md D126).
#
# The builder, previews and publishing run as three Workers under workerd
# (`wrangler dev`), with their D1 database, R2 bucket, Durable Objects and
# Workflow kept in /data. Each preview's sandbox is a container on the
# host's Docker, reached through the socket docker-compose.yml mounts (D137).
# Start it with `docker compose up`; README.md, "Run it with Docker".

FROM docker.io/library/docker:28-cli AS docker-cli

FROM docker.io/library/node:24-bookworm-slim

# The Docker CLI and its build plugin: workerd builds the preview sandbox's
# image and starts its containers through them.
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-buildx \
  /usr/local/libexec/docker/cli-plugins/docker-buildx

# CA certificates for the Docker CLI: it fetches the registry token for the
# sandbox image's base itself, and the slim image has none to verify with.
RUN apt-get update \
 && apt-get install --yes --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# The wrangler every deploy uses (.github/workflows/deploy-web-preview.yml).
RUN npm install --global --no-audit --no-fund wrangler@4.137.0 \
 && npm cache clean --force \
 && corepack enable

WORKDIR /vibld
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts \
 && VITE_VIBLD_AUTH=owner pnpm --filter @vibld/web exec vite build

ENV VIBLD_DATA_DIR=/data
VOLUME /data
EXPOSE 8787 8788 8789
CMD ["node", "docker/start.mjs"]
