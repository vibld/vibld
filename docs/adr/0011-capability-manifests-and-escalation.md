# ADR-0011: Hold the dangerous primitives rather than granting them

- Status: Accepted
- Date: 2026-09-17
- Accepted: 2026-09-17
- Decision owners: maintainers
- Refines: ADR-0006
- Approval: D14, D15, D16 applied to a concrete manifest format

## Context

ADR-0006 requires grants that are represented outside model context, checked
at every trusted tool boundary including retries, and re-decided when scope
changes. It does not say what a grant looks like, what happens when nothing
is declared, or how a request that arrives mid-run is answered. Those three
gaps are the whole of the enforceable part.

Two facts about today's code frame the decision, and both matter:

**Nothing takes a scoped action yet.** A run calls the model once and writes
files. There is no tool loop, no command execution inside a run, no outbound
fetch a run can choose to make. The grant machinery therefore has no
enforcement point today, which is precisely why the format is worth settling
now: the first scoped action will be built against whatever shape exists when
it is written, and a shape invented alongside that feature will be shaped by
that feature.

**The escalation path already has its mechanism.** #158 landed the four
outcomes a run can have and the continuation semantics that follow an `ask`: asking ends the invocation, and answering starts a new
run carrying the held work plus the answer. A capability requested mid-run is
exactly an `ask`, and the run that acts on the approval is exactly the
continuation it starts. That is not a coincidence to note in passing; it is
the reason an approval cannot be banked, and this ADR depends on it.

The vocabulary and the four rules below are taken from Fimo's capability
model, the most carefully built part of that product. The quoted source is in
the [Fimo analysis](https://github.com/vibld/vibld/blob/a4e59c23bfaf31a6770ea2b95abf146538e3d8bb/docs/fimo-competitive-analysis.md),
which is in #157 and not yet merged. That link is pinned to the sha the
issues quote; it wants updating to a path in this repository once #157
lands.

## Decision

**1. The platform keeps the dangerous primitives, and they are not
declarable.**

Writing project files, running commands in the sandbox and committing to the
run's own branch are what a run _is_. They are not capabilities a manifest
can request, because a run without them is not a run, and a manifest that can
request them is a manifest that can be written to look modest while asking
for everything. Promotion stays ours in the same way: `promote` is a
compare-and-set in the control plane (ADR-0007, D12), reached by the runner
and never by anything the model produced.

The rule a manifest states is therefore always **additional reach**: what
this run may touch beyond the project it is editing.

**2. An absent or empty manifest grants nothing.**

The default is not "the usual set". There is no usual set. A run with no
manifest can do what rule 1 says every run can do, and nothing else: no
outbound network beyond what the platform itself brokers, no credential, no
repository other than the project's own, no deployment target. A missing
declaration is a denial, not a fallback, because the alternative is that
forgetting to write one is how a run gets more than it was meant to have.

**3. A wildcard is expanded at run start, and the expansion is what gets
recorded.**

A manifest may be written with a wildcard (`repo:*`, `secret:stripe/*`). It
is resolved into the concrete set of grants that wildcard covered **at the
moment the run started**, and that concrete list is what is stored, shown and
enforced against. The wildcard is an authoring convenience and is never the
record.

This is the rule that survives the namespace growing. A grant recorded as
`secret:stripe/*` and enforced by re-expanding it later silently widens every
time a new secret is added under that prefix: the user consented to three
things and is now enforced against five, with nothing in the record showing
when it changed. Recording the expansion means consent and enforcement are
the same list, and an audit six months later reads what was actually allowed
rather than what the pattern would match today.

**4. A capability requested mid-run is answered by a person, and the approval
applies only to the continuation that answer starts.**

The run stops with an `ask` naming the capability and why it is wanted. It is
over: there is no paused run holding an open request. The person answers, and
that answer starts one continuation carrying the held work, the approval, and
nothing else (`packages/core/src/continuation.ts`, which already enforces
that one answer starts exactly one continuation). A later run wanting the
same capability asks again.

Three sub-rules that are easy to lose:

- **Selecting nothing is a valid denial.** The answer "none of these" is an
  answer, not an absence of one. It ends the work, and the run records a
  discard.
- **An explanatory note never grants access on its own.** Free text alongside
  a selection is context for the run, not a grant. If the selection is empty,
  the note does not rescue it, however much it sounds like assent.
- **Whatever drives a run shows the real request and submits only the answer
  given.** This is the second-order requirement, and it binds Vibld's own
  builder as much as any future client: a surface that summarises the request
  into something friendlier, pre-selects the likely answer, or answers on the
  user's behalf while they are away has defeated every rule above without
  touching the enforcement code. The request shown is the request made.

**Shape.** A manifest is a list of capability identifiers, each with the
scope that makes it enforceable, stored beside the run rather than inside
anything the model can write:

```
capability := "<kind>:<scope>"
kinds      := net | repo | secret | deploy
```

The kinds are deliberately few, and the set is closed for now: a fifth kind
wants an argument, not a caller inventing a name. Each grant carries the
expiry and budget ADR-0006 already requires, and the whole manifest is
recorded with the run, so what a run was allowed to do is answerable
afterwards from the run record rather than from whatever the policy happens
to say now.

## Consequences

**A run cannot quietly acquire reach.** Every widening is a stop, a question
and a new run, which costs a round trip and is meant to. The cost lands on
exactly the flows that want to do more than edit a project, and it is paid in
the one currency that makes the grant meaningful: the person's attention, at
the moment it matters.

**Approvals are not reusable, and users will notice.** Answering the same
question twice in a session is friction, and the standing-grant escape hatch
ADR-0006 allows ("a standing grant avoids repeated prompts only within its
approved scope") is deliberately not being extended to mid-run escalation
here. If that proves unworkable in practice, the fix is a standing grant
declared up front in the manifest, where it is visible before the run starts,
not an approval that silently outlives the run it was given to.

**The wildcard expansion has to be stored, not recomputed.** That is a real
schema requirement: a grants table with one row per concrete capability per
run, not a manifest blob re-parsed on read. Recomputing is the bug this rule
exists to prevent, and it is the cheaper implementation, so it is the one
that will be written unless the schema forbids it.

**This ADR adds no enforcement code by itself.** There is nothing to enforce
against until the first scoped action exists. What it adds is the shape that
action will be built against, and the rule that it cannot be built without
one.

**It also binds our own UI.** Rule 4's second-order requirement is a claim
about the builder, not only about a future API client, and it is testable:
the request shown and the answer submitted are both things a test can assert
on.

## Alternatives considered

- **Make the dangerous primitives declarable, with a sensible default set.**
  Uniform, and it fails the first time somebody reads a manifest to decide
  whether to approve it: a declaration that lists `files:write` next to
  `net:api.example.com` invites the reader to weigh them against each other,
  when one of them is what every run does and the other is the entire
  question. Rejected because the manifest's job is to make the unusual
  visible.
- **Default to a starter set when no manifest is declared.** Kinder to a
  caller who forgot, and it makes forgetting the way to get more reach than
  intended. Rejected.
- **Re-expand wildcards at enforcement time.** Simpler, and one line of
  code. It means a grant silently widens as the namespace grows, and neither
  the user nor the audit trail can see when. Rejected: this is the specific
  failure the rule exists for.
- **Let an approval stand for the rest of the session.** What most products
  do, and the reason capability prompts get clicked through. Rejected here;
  if the friction is real, the answer is an up-front standing grant that is
  visible before the run starts.
- **Wait until the first scoped action needs it.** My own first
  recommendation, and the honest argument for it is that a format with no
  consumer gets shaped by guesswork. Rejected for the same reason #158 was
  built early: by the time the consumer exists, whatever shape is lying
  around is load-bearing.
