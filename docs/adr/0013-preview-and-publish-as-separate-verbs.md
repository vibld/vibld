# ADR-0013: Keep preview and publish separate, and never let a run publish

- Status: Proposed
- Date: 2026-09-17
- Decision owners: maintainers
- Refines: ADR-0006, ADR-0010
- Approval sought for: the authorisation rules D22's publishing milestone is built against

## Context

D22 puts publishing after the build/edit loop, and ADR-0010 has already
proposed the mechanism: a slug on `*.published.vibld-preview.dev`, served
from Vibld's own account, with an opt-in custom domain. What neither settles
is whether previewing and publishing are one action or two, and whether an
automated run may publish at all.

Deciding it after the deploy path exists means unpicking it, which is the
argument for doing it now. The threat model is the other argument, and it is
the stronger one.

Where the code stands today, verified rather than assumed:

- `/api/preview` (POST) starts a sandbox; `/api/preview/share` (POST) mints
  an explicit, revocable public link for one. Private by default, per D17 and
  ADR-0006, and already implemented that way.
- `/api/publish` (POST) builds an accepted checkpoint and puts it on a slug.
  It resolves a principal, it is behind the invite gate, and it has exactly
  one caller: the publish button in the builder, driven by a person clicking
  it.
- Nothing automated can reach it. There is no scheduled generation, no
  webhook that starts a run, and the one cron in the codebase checks provider
  balances.

So the rule below is, today, true by construction. That is the reason to
write it down rather than a reason not to: it is free now, and it stops being
free the first time a trigger is added. The Stripe webhook already
demonstrates the shape of the risk, being an unauthenticated POST whose body
is attacker-controllable until the signature is checked.

Fimo separates `deploy` from `deploy --publish`, bars its agents from
publishing entirely, and states the webhook case explicitly; the quoted
source is in the [Fimo analysis](https://github.com/vibld/vibld/blob/a4e59c23bfaf31a6770ea2b95abf146538e3d8bb/docs/fimo-competitive-analysis.md),
which is in #157 and not yet merged.

## Decision

**Preview and publish are distinct operations with distinct authorisation.**

Producing a preview never makes anything public. Publishing is its own verb,
its own permission, and its own audit record. A grant to preview is not a
grant to publish, and no sequence of preview calls adds up to one.

**Publishing carries its own confirmation, naming what goes live.**

Not a generic "are you sure": the confirmation names the project, the slug it
will be reachable at, and the checkpoint being published. A confirmation that
does not say what is about to become public is a click, not a decision.

**Accepting a checkpoint is not publishing it.**

`promote` moves the accepted revision (ADR-0007, D12) and changes nothing
about what the world can see. These are adjacent in the UI and completely
separate in effect, and the UI has to keep saying so: the existing publish
button already distinguishes "live at" from the current checkpoint for this
reason, and that distinction is load-bearing rather than cosmetic.

**An automated or scheduled run cannot publish.**

Not "can publish if the payload says so": cannot. The capability is not
available to a run at all, which under ADR-0011 means it is not a declarable
capability for one. The audit record of a publish always names a person.

**The payload that triggered a run is never read as approval to publish.**

This is the sub-rule that makes the previous one real, and the one most
likely to be argued away by a plausible feature request ("let the deploy hook
ship it"). A webhook body, an issue comment, a commit message, a scheduled
job's parameters: all of these are attacker-influenced input. Anyone who can
open a pull request, comment on an issue, or forge a delivery to an endpoint
whose signature check has a gap can put text into them. Text in an input is
not a person asking. Only a request a person made in that moment, asking for
it, can go live.

**Rollback is a first-class, person-taken action.** A publish that can be
undone by the person who made it is part of the decision, not a follow-up:
ADR-0010's slug-to-R2-prefix mapping makes it a pointer change rather than a
rebuild, and the same confirmation rules apply, naming what goes back.

**Tests this requires**, stated because they are the enforcement:

1. A preview stays private: creating one exposes nothing publicly, and the
   raw sandbox URL does not bypass access control (ADR-0006 already requires
   this test; it is named again because it is half of this decision).
2. A triggered run cannot publish, whatever its input says. The test drives a
   run from a payload that asks to publish in as many words and asserts that
   nothing was published.
3. A rollback after a publish restores the previous checkpoint, and the live
   site serves it.

## Consequences

**A deliberate, unautomatable step in the deploy path.** Continuous
deployment from a Vibld project is not possible through Vibld, by design. For
a user who wants it, the exit is the one ADR-0002 already guarantees: export
the project, or push it to their own repository (D8), and run whatever
pipeline they like from there, with their own credentials and their own
decision about what may deploy without a human. Vibld does not become that
pipeline.

**A publish endpoint that cannot be driven by a service.** Any future
automation, including Vibld's own, has to stop at the confirmation. That is
a real constraint on features not yet designed, and accepting it now is the
point of the ADR.

**The rules are free today and must be kept free.** Nothing automated can
publish now, so none of this costs anything to adopt. The cost arrives with
the first trigger, and so does the risk, which is why the tests exist: they
fail the day somebody wires a run to an event without noticing that the event
is now deciding what goes live.

**Rollback needs its own retention.** "Restore the previous checkpoint"
requires the previous checkpoint's build output to still be there, which is a
storage and retention decision ADR-0010 did not make. How many published
revisions are kept, and for how long, is left open here and has to be settled
before publishing ships.

## Alternatives considered

- **One verb with a flag** (`publish: true` on the preview call). Fewer
  endpoints, and the flag is exactly the thing an automated caller sets. The
  separation exists to make going live a different act, and a boolean is not
  a different act. Rejected.
- **Allow an automated run to publish to a staging slug only.** Genuinely
  useful, and it puts the decision back on "which slug is staging", which is
  configuration an attacker-influenced payload can also name. Rejected for
  now; revisit only with a target that cannot be selected by the payload.
- **Allow publish from a trigger when the payload is signed.** A signature
  proves the sender, not the intent: a signed webhook from a repository
  anyone can open a pull request against still carries whatever text that
  pull request put in it. Rejected, and this is the argument the rule exists
  to settle in advance.
- **Let a standing grant cover publishing** (ADR-0006 allows standing grants
  within an approved scope). Consistent with the rest of the permission
  model, and it would let a run publish without a person present, which is
  the exact outcome this ADR forbids. Rejected: publishing is the one verb
  where the standing-grant escape hatch does not apply.
- **Decide this when the deploy path is built.** It would be decided by
  whatever was convenient to implement, and unpicking an automated publish
  after users depend on it is worse than declining to build one. Rejected.
