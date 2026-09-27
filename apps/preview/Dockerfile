# Cloudflare's own published Sandbox SDK image (Node + npm, cloudflared,
# the container-side sandbox server) -- version-matched to the
# @cloudflare/sandbox npm dependency in package.json. Bump both together.
FROM docker.io/cloudflare/sandbox:0.12.9

# Vite's default dev-server port (worker/preview-sandbox.ts's DEV_PORT).
# Documents the port this image serves; exposePort() is what actually
# forwards it, not this line.
EXPOSE 5173
