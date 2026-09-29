# Cloudflare's own published Sandbox SDK image (Node + npm, cloudflared,
# the container-side sandbox server) -- version-matched to the
# @cloudflare/sandbox npm dependency in package.json. Bump both together.
FROM docker.io/cloudflare/sandbox:0.12.10

# The generation stack, already installed (D74). Every preview used to
# start with a cold `npm install` of the same hundred-odd packages, which
# was most of the minute or two a first preview took. The stack
# (packages/ai/src/stack.ts, copied to warm/package.json and kept equal to
# it by packages/ai/test/preview-warm-cache.test.ts) is installed here once,
# and a preview moves this node_modules into its project before its own
# `npm install` (worker/provision.ts's SEED_COMMAND), which then only
# reconciles it with what the project declares: it adds anything beyond
# the stack from the registry as before (the egress allowlist is
# unchanged) and `npm prune` removes whatever the project does not declare,
# so an import the project never declared still fails here as it would in a
# clean install (#194).
#
# A prebuilt node_modules rather than a warmed npm cache, on measurement: at
# the container's size (a quarter of a CPU, 1 GiB) a cold install of the
# stack took about 111 seconds, one from a warm cache 87 to 98 (the time
# goes on unpacking and writing packages, not on the network), and one on
# top of this tree 13 to 27, prune included. The cache also weighed more:
# npm keeps every package document it reads, 277 MB of them for this stack
# against 38 MB of tarballs, so it is cleared here rather than shipped.
# This layer adds about 39 MB compressed to the image (228 MB to 267 MB).
COPY warm/package.json /opt/warm/package.json
RUN cd /opt/warm \
 && npm install --no-audit --no-fund \
 && npm cache clean --force \
 && chmod -R a+rwX /opt/warm

# Vite's default dev-server port (worker/provision.ts's DEV_PORT).
# Documents the port this image serves; exposePort() is what actually
# forwards it, not this line.
EXPOSE 5173
