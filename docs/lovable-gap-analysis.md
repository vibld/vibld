# What Lovable and open-lovable do that Vibld does not

Grounded in sources that can be checked, not recall:

- **open-lovable** (firecrawl/open-lovable, MIT) read from a working copy of
  the repository — route names, prompt text and schemas quoted below are read
  from its source, not remembered.
- **Lovable's own product surface** read from its MCP server's catalogue
  (`list_connectors`, `list_design_systems`, `list_template_projects`) against
  a real workspace, and from the documentation URLs that catalogue publishes.

Everything marked _inferred_ is an inference and says so.

## open-lovable's API surface

Twenty-eight routes under `app/api/`. Grouped by what they buy:

| Group               | Routes                                                                                                                     | Vibld                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Sandbox lifecycle   | `create-ai-sandbox`, `create-ai-sandbox-v2`, `kill-sandbox`, `sandbox-status`, `sandbox-logs`                              | none                                    |
| Applying code       | `apply-ai-code`, `apply-ai-code-stream`, `get-sandbox-files`                                                               | staged checkpoints, no execution        |
| Dependencies        | `detect-and-install-packages`, `install-packages`, `install-packages-v2`                                                   | none                                    |
| Error feedback loop | `check-vite-errors`, `clear-vite-errors-cache`, `monitor-vite-logs`, `report-vite-error`, `restart-vite`, `validate-build` | static validation only                  |
| Targeted editing    | `analyze-edit-intent`                                                                                                      | see below                               |
| Clone a website     | `scrape-website`, `scrape-url-enhanced`, `scrape-screenshot`, `extract-brand-styles`, `search`                             | none                                    |
| Export              | `create-zip`, `export-to-github`                                                                                           | `.zip` (#57); GitHub export outstanding |
| Conversation        | `conversation-state`                                                                                                       | `BuilderState.transcript` (#55)         |

The first four groups are all one capability: **run the generated project and
feed its errors back to the model.** That is the preview, the repair loop and
the dependency handling at once, and it is the largest single gap.

The clone-a-website group is Firecrawl's own differentiator rather than
Lovable parity, and it is the one group Vibld may not want at all.

## The finding that changes a decision already on the table

ADR-0009 (Proposed) asks whether to send a whole generated project with a
follow-up request. Its alternatives were: send paths only, truncate, or wait
for retrieval (#12, which needs pgvector and an embedding provider).

open-lovable takes a fourth path that needs no infrastructure. Its
`analyze-edit-intent` route asks a **small, cheap model** for a _search plan_
rather than for file contents or for a file list:

```ts
// app/api/analyze-edit-intent/route.ts — the schema, verbatim
const searchPlanSchema = z.object({
  editType: z.enum([
    'UPDATE_COMPONENT', 'ADD_FEATURE', 'FIX_ISSUE', 'UPDATE_STYLE',
    'REFACTOR', 'ADD_DEPENDENCY', 'REMOVE_ELEMENT',
  ]),
  reasoning: z.string(),
  searchTerms: z.array(z.string()),        // exact button text, class names
  regexPatterns: z.array(z.string()).optional(),
  fileTypesToSearch: z.array(z.string()).default(['.jsx', '.tsx', '.js', '.ts']),
  expectedMatches: z.number().min(1).max(10).default(1),
  fallbackSearch: z.object({ ... }).optional(),
});
```

Its own comment is the point: `// Schema for the AI's search plan - not file
selection!` The model is given a one-line summary per file — path, component
name, what it renders — and answers with what to grep for. Exact search then
finds the files. `expectedMatches` and `fallbackSearch` exist because the
first plan can miss.

This matters because ADR-0007 prescribes "exact file/symbol search combined
with semantic retrieval", and this is the exact-search half working **without
the semantic half** — no vector store, no embedding provider, no disclosure to
one. It is a credible middle option between "send everything" and "wait for
#12", and ADR-0009 should have listed it. Its cost is one extra model call per
turn and the risk that a bad search plan sends the wrong files.

Not a recommendation. It needs measuring against the current approach before
anyone should prefer it — and the current approach has the advantage that it
cannot silently miss a file.

## Lovable's product surface

From the MCP catalogue, against a real workspace:

- **90 standard connectors** — OAuth API integrations across sales, marketing,
  messaging, ecommerce, analytics, CMS and data warehouses.
- **6 seamless integrations** — zero-config: Lovable Cloud (its own backend),
  an AI gateway, Stripe, Paddle, Shopify, external Supabase.
- **17 MCP servers** the agent can be given, including Figma, Linear, Notion,
  PostHog, Sentry.
- **Design systems and template projects** as first-class workspace objects
  (`design_systems`, `template_projects`) that a new project starts from.
- **Project and workspace knowledge** — persistent instructions the agent
  carries across turns — and **workspace skills**, reusable named workflows.
- **Plan mode** — discuss the approach before any code is written.

The connector count is the moat, and it is not a moat Vibld should try to
cross by breadth. Two observations instead:

1. **Design systems as objects** is cheap and close to work already done. The
   style presets (#56) are a fixed set of eight; a design system is a
   user-owned, reusable one. The step from one to the other is small.
2. **Project knowledge** is standing instructions that survive turns. With the
   transcript (#55) and project context (#58) in place, this is a small
   addition with an outsized effect on a long session — and it is the piece
   that stops someone re-typing "keep it dark, no rounded corners" every turn.

_Inferred:_ Lovable's editor is chat-left / preview-right with Visual Edits
(click an element, change it directly) and a Themes panel. Vibld matches the
layout as of #55. Visual Edits and Themes both require a running preview, so
they sit behind the same gap as everything in the first table.

## What this suggests, in order

1. **Run the generated project.** Everything else of consequence is behind it:
   preview, the error-repair loop, Visual Edits, Themes. It needs a decision
   about _where_ — a sandbox service, or an in-browser compiler in a
   `sandbox="allow-scripts"` frame — that has cost and security consequences in
   both directions.
2. **Project knowledge.** Small, unblocked, and compounding.
3. **User-owned design systems**, generalising #56.
4. **GitHub export**, already tracked.

Clone-a-website is deliberately last, and may belong nowhere: it is
Firecrawl's product, not Lovable's, and it is the one feature here that makes
Vibld's output someone else's design.
