# M0 and M1 implementation plan

This plan applies the [accepted D1-D30 decisions](decisions.md). GitHub issues track completion; unchecked work below is not implemented. Keep implementation PRs small enough to review. Do not provision infrastructure or run paid model evaluations until account access, configuration and spending limits are confirmed.

## Work order

| Stage | Outcome                                                                                              | Issues                                                                                                                                                                                                                                            | Depends on                                                           |
| ----- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 0     | Enforced repository baseline and verified private reporting                                          | [#2](https://github.com/vibld/vibld/issues/2), [#17](https://github.com/vibld/vibld/issues/17); tracker [#1](https://github.com/vibld/vibld/issues/1)                                                                                             | Reviewed decisions and governance                                    |
| 1     | Small domain contracts and an independently buildable fixed marketing template                       | [#8](https://github.com/vibld/vibld/issues/8), [#5](https://github.com/vibld/vibld/issues/5)                                                                                                                                                      | Stage 0                                                              |
| 2     | Fixed-template sandbox/preview feasibility test; invited-user shell, storage, permissions and quotas | [#6](https://github.com/vibld/vibld/issues/6), [#14](https://github.com/vibld/vibld/issues/14), [#11](https://github.com/vibld/vibld/issues/11), [#15](https://github.com/vibld/vibld/issues/15), [#18](https://github.com/vibld/vibld/issues/18) | Stage 1; verified infrastructure capabilities and approved budget    |
| 3     | Fake-provider prompt-to-checkpoint flow, then bounded live generation                                | [#9](https://github.com/vibld/vibld/issues/9), [#16](https://github.com/vibld/vibld/issues/16)                                                                                                                                                    | Stage 2 controls; begin deterministic tests without paid credentials |
| 4     | Revision-scoped retrieval and GitHub branches/PRs                                                    | [#12](https://github.com/vibld/vibld/issues/12), [#13](https://github.com/vibld/vibld/issues/13)                                                                                                                                                  | Stable contracts, durable checkpoints and permission enforcement     |
| 5     | Measured model selection and hosted-alpha acceptance                                                 | [#9](https://github.com/vibld/vibld/issues/9), [#10](https://github.com/vibld/vibld/issues/10); tracker [#4](https://github.com/vibld/vibld/issues/4)                                                                                             | All M1 capabilities; approved live-evaluation budget                 |

Build the evaluation harness alongside each slice, not after integration. Stage 2 work can overlap where its interfaces are stable, but private-preview acceptance depends on identity, permissions and budgets. No invited user runs untrusted code before those controls pass. Do not turn the feasibility test into a public service.

## First product acceptance scenario

An invited user requests a cybersecurity SaaS landing page with pricing, FAQ and a contact form. The builder explains its plan, generates a prerendered site, shows stage progress and presents a private working preview. A form without a backend must state that it is a demonstration.

The user can inspect changes and validation, save a checkpoint, reopen the project after sandbox eviction, and export a standalone project. With a scoped GitHub connection and approved destination, the user can create a branch and PR. Retrieval returns only the permitted project's current revision. Failure leaves the previous accepted checkpoint available and explains the failed stage without leaking secrets.

The follow-up request, "Make the hero simpler and reduce pricing from three plans to two," is the M2 conversational-edit acceptance scenario. The M1 bounded repair path provides groundwork but does not count as completing M2.

## Long-running generation streams

Generation outlives a normal request, and a stream that carries only model
output goes silent whenever the model is thinking. Browsers, mobile networks
and intermediate proxies drop an idle connection long before a job runtime's
own timeout, which surfaces to the user as a stream that "ended" with no error
and no failed stage.

Any transport that streams generation progress must therefore emit
transport-level keepalive events on its own schedule, independent of model
token activity, for as long as the run is active. Requirements:

- The keepalive interval is configuration, not a literal in route code, and has
  a documented default calibrated against the deployed edge and proxy timeouts.
  Do not assume a value carried over from an earlier system.
- Keepalives are driven by a timer over the whole run, not piggybacked on
  progress events, so a long planning phase before the first token still keeps
  the connection warm.
- Keepalive frames carry no project content, prompt text or credentials, and a
  client that ignores them must still parse the stream correctly.
- Stopping the keepalive is part of stream teardown on success, failure,
  cancellation and client disconnect; a leaked timer must not keep a run's
  resources alive.
- Reconnection and replay stay the mechanism for surviving a genuinely dropped
  connection. A keepalive reduces spurious drops; it does not replace durable
  run state (ADR-0007).

Cover an idle-model run, a client disconnect and a cancelled run in the stream
tests.

## Release evidence

- Run a versioned prompt set covering different marketing layouts and content needs. Proposed initial target: ten prompts, three runs each, at least 27 of 30 successful within at most two repair attempts. Calibrate and record the gate before alpha admission; report uncertainty rather than generalizing from 30 runs.
- Report first-pass and post-repair success separately, along with first-preview time, cost per accepted result and the total cost of failures. Record provider/model/template versions and relevant run configuration.
- Every result counted as accepted passes an independent clean install, typecheck, build and run after export without Vibld services or `.vibld/`. Inspect route HTML, metadata, console failures, keyboard use and mobile layouts. Set performance/accessibility thresholds in the fixture specification; never use compiler success as a substitute.
- Inject invalid model output, install/build failure, timeout, cancellation, network loss, eviction, interrupted save, stale writer, stale index and ambiguous GitHub response. Verify bounded termination, conflict visibility, checkpoint recovery and deduplication.
- Prove cross-tenant denial across API, storage, retrieval, live status and previews. Test raw sandbox URL bypass, preview sharing expiry/revocation and credential redaction. A failing security invariant blocks release regardless of generation score.
- Test limits under concurrent requests and retries. Meter sandbox lifetime, token/tool usage, object retention and abandoned resources. Operator cleanup must not depend on a browser remaining connected.

Normal CI uses deterministic providers and test data without live credentials. Real-provider tests and the model bakeoff are separate gated runs. Nothing in this plan approves a paid allowance.

## Operational decisions before live use

| Detail                                          | Required evidence                                                                                       | Owner / tracked in            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Account capabilities, regions and service tiers | Cloudflare Sandbox access/limits and Supabase connection/backup requirements confirmed; budget approved | Lead maintainer; #6, #11, #14 |
| Preview origin and sessions                     | Selected domain, cookie isolation, all-path authorization and bypass tests                              | #6, #14, #15                  |
| User-secret storage and encryption keys         | Key separation, rotation/recovery/deletion design and tests                                             | #15                           |
| Authenticated SQL                               | Least-privilege roles, tenant enforcement and transaction/pooling tests; no stale authorization cache   | #11, #14                      |
| Models and embeddings                           | Versioned comparison, source-processing disclosure and approved spending cap                            | #9, #10, #12                  |
| Budgets and retention                           | Numeric run/account caps, backup deletion windows, telemetry schema and opt-out policy                  | #11, #18                      |
| Operations                                      | Monitoring, safe diagnostics, incident owner, resource cleanup and restore drill                        | #6, #11, #17, #18             |

Chris Brock approves product/security tradeoffs and spending. Implementation issues identify the engineer or agent doing the work when assigned; this plan does not assign work to external people or authorize new credentials.

## Scope boundaries

The current deliverable is repository documentation and backlog alignment. Root TypeScript/pnpm/Turborepo configuration remains intact. Do not create empty implementation packages or change dependencies just to match a conceptual diagram.

M0 remains open until quality enforcement and private reporting are verified. M1 remains open until all hosted-alpha gates pass. M2 adds reliable conversational editing; publishing follows, then one full-stack integration, then visual targeting. An alternate runtime/self-hosting path needs evidence before making a working standalone OSS claim.

Brand/landing-page work [#7](https://github.com/vibld/vibld/issues/7) and extensive contributor templates [#3](https://github.com/vibld/vibld/issues/3) remain open but deferred. This keeps their history without treating them as release blockers.
