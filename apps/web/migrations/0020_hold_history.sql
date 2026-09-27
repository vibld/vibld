-- What an operator did to a published site, kept after the fact (#172).
--
-- `published_projects.held_at`, `held_by` and `held_reason` are the *current*
-- state: they are what public serving and the republish refusal read. They
-- are not a record, and the first cut of the operator takedown mistook one
-- for the other. Releasing a hold nulls all three, so after the ordinary
-- hold-then-release there was no evidence the site had ever been taken
-- down, who did it, why, or who lifted it. That directly contradicted the
-- reason the columns were added: SECURITY.md calls security-sensitive
-- actions auditable, and a takedown of work that is not yours is the
-- clearest case of one.
--
-- So the state stays where serving can read it cheaply, and the record
-- lives here, appended and never updated. Both halves are written: a hold
-- and a release are each an action somebody took.
--
-- No project content, no path, no prompt. A slug, an actor, a reason and a
-- time -- the same discipline D20 applies to operational telemetry, applied
-- to a thing that is deliberately not telemetry.
CREATE TABLE published_site_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- The site acted on. Not a foreign key: the record has to outlive the row
  -- it describes, which is the entire point of keeping it separately.
  slug TEXT NOT NULL,

  -- 'held' or 'released'.
  action TEXT NOT NULL,

  -- The platform admin who did it, by the email their Clerk identity was
  -- verified under.
  actor TEXT NOT NULL,

  -- Why. Required on a hold, and null on a release, where the act is
  -- undoing rather than doing.
  reason TEXT,

  at TEXT NOT NULL
);

CREATE INDEX idx_published_site_holds_slug ON published_site_holds(slug, at);
