-- A published site's own domain (docs/decisions.md D189).
--
-- One per project, and a hostname belongs to one project at a time. The
-- hostname is what a visitor's request carries, so it is the key
-- apps/publish looks a site up by; `cloudflare_id` is the custom hostname
-- Cloudflare for SaaS made for it on the preview zone, which is what
-- removing it, or asking whether its certificate is ready, names.
--
-- Whether the domain works yet is not stored. Cloudflare decides that
-- (the owner's DNS record, then the certificate) and the builder asks it.
-- A request only reaches apps/publish on this hostname once Cloudflare
-- has activated it, so a row whose domain is still pending serves nobody.
CREATE TABLE custom_domains (
  hostname TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  cloudflare_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- When the nightly pass last asked whether the account's plan still
  -- has custom domains (D189: disconnected once it reads Free), and
  -- created_at until it first has. The pass takes the oldest first, so a
  -- new domain waits its turn behind the ones checked before it existed
  -- rather than ahead of all of them.
  checked_at TEXT
);

CREATE INDEX custom_domains_user ON custom_domains (user_id);
CREATE INDEX custom_domains_checked ON custom_domains (checked_at);
