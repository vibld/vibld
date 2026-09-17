# ADR-0012: Serve agent instructions, version-stamped, rather than vendoring them

- Status: Accepted
- Date: 2026-09-17
- Accepted: 2026-09-17
- Decision owners: maintainers
- Refines: ADR-0002, ADR-0009

## Context

A Vibld project does not stay in Vibld. ADR-0002 is explicit that the
generated application is portable and owes Vibld nothing: the marketing
template's own README says "copy it somewhere else and it still installs,
builds and runs", and its `vibld.json` says in the file itself that nothing
in the project reads it. That is the contract, and it is the constraint this
decision has to work inside.

What lands in somebody else's coding agent today carries no instructions at
all. The obvious fix is to write an `AGENTS.md` into every generated project,
and it is the fix that ages worst. Vibld's conventions are expected to change
(the pattern catalogue was authored three weeks ago and has already been
revised); a project generated today would keep teaching the conventions of
the week it was made, with nothing in the file to say which week that was.
The agent reading it cannot tell a deliberately pinned older set from a stale
copy nobody updated, so it either follows stale guidance or silently
"upgrades" a project whose owner chose the older behaviour. Both are worse
than no file.

One more fact worth stating plainly, because it constrains the stamp: this
repository has no version to stamp with. The root `package.json` is `0.0.0`,
nothing is tagged, and no endpoint reports a build. Whatever version stamps
an instruction set has to be the instruction set's own, declared and
incremented deliberately, not read off a release that does not exist.

The mechanism below is what Fimo does through its CLI, including the
do-not-auto-upgrade rule and the identifiers-not-paths rule; the quoted
source is in the [Fimo analysis](https://github.com/vibld/vibld/blob/a4e59c23bfaf31a6770ea2b95abf146538e3d8bb/docs/fimo-competitive-analysis.md),
which is in #157 and not yet merged.

## Decision

**A thin pointer in the project; the instructions served on demand.**

The generated project carries a small, deletable file naming the instruction
set and its version, and nothing else of substance. `vibld.json` already
exists for exactly this purpose and already carries `templateVersion`, so the
pointer is two more fields there rather than a new file:

```json
{
  "instructions": "vibld/marketing",
  "instructionsVersion": "1.0.0"
}
```

The real instructions are served, addressed by that pair. The pointer stays
inert: deleting `vibld.json` leaves a project that still installs, builds,
typechecks, tests and runs, exactly as the file's own `$comment` promises
today. ADR-0002 is not weakened by this, and any proposal that would make the
build depend on a served document contradicts it.

**Stamped, and never silently upgraded.**

What is served says which version it is. An agent that finds
`instructionsVersion: "1.0.0"` in a project and is served 1.0.0 knows it has
what the project was built against. An agent holding a project pinned to an
older set gets that older set, with the newer one's existence reported and
not applied. Nothing upgrades a project's instructions without somebody
asking, because "your project now follows different conventions" is a change
to their code's future, not a documentation refresh.

**Reference material is addressed by identifier, not by path.**

Instructions refer to other documents as identifiers resolved through the
same path (`vibld:patterns/saas-dashboard`), never as a repository path or a
URL into a file tree. Documents move; a project generated in March should not
break because a file was reorganised in June. The identifier is the contract;
where it resolves is ours to change.

**One canonical file; per-tool variants generated from it.**

There is one source document per instruction set. The per-tool files the
various coding agents look for are generated from it, and two rules govern
writing them: create only what is missing, and never overwrite a file
somebody has edited. A user who has written their own house rules into the
file their agent reads has said something; replacing it with ours is
overwriting their work to deliver a document they did not ask for.

**One rule carried across from the same source, because it belongs here.**
Instructions that describe how to check a site must not let a preview
measurement be reported as published-site performance. They are different
machines, different networks and different caches, and a number taken from
one and labelled as the other is a false claim about somebody's site. Vibld's
own validation suite has the same obligation, and it is worth writing into
the instruction set so the agent editing the project afterwards inherits it.

## Consequences

**A served document is a runtime dependency for the _agent_, not for the
project.** The distinction is the whole design. If the service is down, the
agent works without instructions, the way it does today; the project still
builds. Nothing in the generated output acquires an availability dependency,
which is the line ADR-0002 draws.

**Versioning becomes a real obligation.** An instruction set that is served
must be versioned deliberately, old versions must keep being served, and
"what changed between 1.0.0 and 1.1.0" becomes a question with an answer.
That is work, and it is the work that makes the pointer honest. A version
that silently changes what it serves is worse than the vendored file this
decision replaces.

**The pointer is advisory and will be deleted by some users.** That is
correct and intended: it is provenance, not a licence check. A project
without it simply gets no instructions, the current state of the world.

**It says nothing about what the instructions contain.** The content, and
whether it duplicates the pattern catalogue (`packages/ai/src/patterns.ts`)
or is served from it, is a separate decision. This one settles where
instructions live and how they are addressed.

**Nothing here is built yet, and nothing should be until an instruction set
exists to serve.** Serving a document that has not been written is the
failure mode this ADR is most at risk of: the mechanism is easy and the
content is the hard part.

## Alternatives considered

- **Vendor `AGENTS.md` into every generated project.** One file, no service,
  works offline, and it is what most tools do. It freezes the conventions of
  the generating week into a file with no version on it, so a stale copy and
  a deliberate pin are indistinguishable. Rejected, and it is the specific
  failure this decision is about.
- **Vendor it, but stamp it with a version.** Better: the staleness is at
  least legible. It still cannot be corrected without editing somebody's
  repository, and every project on the old version is a project teaching
  guidance we have since decided was wrong. Rejected, though it is the
  fallback if the served path proves unworkable.
- **Reference documents by path or URL.** Readable in a diff, and it makes
  every reorganisation a breaking change for projects already generated.
  Rejected.
- **Generate the per-tool variants unconditionally, overwriting what is
  there.** Guarantees they are current. It also deletes a user's own
  instructions to their own agent, which is their work and not ours to
  replace. Rejected without qualification.
- **Serve the instructions and have the project fetch them at build time.**
  Makes the project's build depend on Vibld being up, which is the one thing
  ADR-0002 forbids. Rejected outright.
