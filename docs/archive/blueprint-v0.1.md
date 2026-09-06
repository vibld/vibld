# Vibld Product & Technical Blueprint

Domain: vibld.com  
GitHub: github.com/vibld  
npm namespace: @vibld  
Working tagline: Vibe. Build. Ship.  
Project model: Open-source core + optional managed cloud

## 1. Product Thesis

### What Vibld is

Vibld is an open-source AI application builder that turns natural-language intent into real, editable, portable web applications.

The user should be able to:

- Describe what they want.
- Let Vibld plan the implementation.
- Watch the application take shape.
- Interact with a live preview.
- Refine it conversationally or visually.
- Inspect and edit the underlying code.
- Connect services and data.
- Commit everything to Git.
- Deploy wherever they choose.

Vibld should feel approachable to someone who does not write code while remaining trustworthy and useful to someone who does.

### Core principle

The application belongs to the user, not to Vibld.

Generated projects should be conventional software projects that continue working without Vibld.

No proprietary runtime should be required merely to keep an exported application functioning.

## 2. Why Vibld Exists

AI builders are rapidly becoming capable development environments, but the category is trending toward increasingly vertically integrated commercial platforms.

Vibld should offer a different model:

- Open-source core
- Transparent generation
- Portable code
- Git-native workflow
- AI-provider independence
- Deployment-provider independence
- Self-hostability
- Standard frameworks
- Extensible architecture
- Local development compatibility
- No artificial requirement to keep a project inside Vibld

The long-term opportunity is not:

"Open-source Lovable."

It is:

The open application-building layer for AI-assisted software development.

## 3. Product Principles

Every major architectural or product decision should be evaluated against these principles.

### 1. Own your code

The repository is the product artifact.

### 2. Git is canonical

Vibld should treat Git as a first-class system rather than an export feature.

### 3. Open by default

Core building capabilities should not depend on Vibld Cloud.

### 4. Providers are replaceable

Models, databases, authentication systems and deployment targets should operate through adapters.

### 5. Generated code should look human

Avoid enormous generated abstractions or Vibld-specific magic.

### 6. Explain before changing

Major AI actions should have understandable intent.

### 7. Preserve user work

AI modifications should be patch-oriented and Git-aware rather than repeatedly regenerating whole projects.

### 8. Secure generation is part of generation

Security validation is not merely a post-build scanner.

### 9. Progressive complexity

A nontechnical user should be able to build without understanding the architecture.

A developer should be able to inspect and control everything.

### 10. Escape hatches everywhere

Users should always have access to code, terminal, Git, environment variables and deployment configuration where appropriate.

## 4. Initial Target Users

### Primary

#### Vibe builders

People capable of describing software but who do not necessarily want to write every line themselves.

#### Developers

Developers who want AI to accelerate scaffolding, UI work, CRUD functionality and repetitive implementation.

#### Technical founders

People validating and shipping products rapidly.

#### Agencies and consultants

Teams repeatedly building applications, landing pages, prototypes and client portals.

### Later

- Product managers
- Internal innovation teams
- Designers
- Enterprise development teams
- Education
- Internal application development
- Design-system driven organizations

## 5. MVP Definition

The MVP must prove one loop extremely well:

Describe → Plan → Build → Preview → Modify → Git

Everything else is secondary.

### MVP user journey

#### Step 1: Create project

User enters:

> Build me a lightweight CRM for a commercial printing company with contacts, companies, opportunities and a dashboard.

#### Step 2: Vibld creates a plan

Before generating substantial code, Vibld produces an internal structured plan covering:

- Pages
- Components
- Data entities
- Dependencies
- Application architecture
- Implementation sequence

The UI can summarize this without overwhelming the user.

#### Step 3: Generate

Vibld creates the initial application.

#### Step 4: Run

A sandbox installs dependencies and launches the application.

#### Step 5: Preview

The application appears beside the conversation.

#### Step 6: Validate

Vibld automatically checks:

- Build
- TypeScript
- Runtime errors
- Basic responsive behavior
- Critical browser console errors

#### Step 7: Iterate

User says:

> Put opportunities into a kanban board and make the dashboard less busy.

Vibld identifies the relevant files and applies a targeted patch.

#### Step 8: Git

Changes are represented as meaningful diffs and commits.

#### Step 9: Export/sync

User can download, clone or push the complete project.

## 6. Explicitly Out of Scope for MVP

Do not allow these to delay the core loop:

- Multiplayer collaboration
- Enterprise SSO
- Marketplace
- Mobile application generation
- Complex visual Webflow-style editor
- Proprietary database platform
- Proprietary auth platform
- Full DevOps platform
- Enterprise governance
- Figma import
- Team billing
- Custom domains
- AI image generation
- Plugin marketplace
- Native mobile IDE
- Full production observability

Some can appear soon after MVP, but none are prerequisites for proving Vibld.

## 7. Generated Application Standard

Vibld should initially be opinionated.

### Default frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- Radix primitives where appropriate
- Lucide icons

### Default quality requirements

Every generated project should support:

```text
npm install
npm run dev
npm run build
npm run lint
```

Prefer:

```text
npm run typecheck
npm test
```

when appropriate.

### Project requirements

Generated applications should:

- Use conventional directories
- Avoid Vibld-specific runtime dependencies unless genuinely needed
- Keep dependencies minimal
- Use semantic HTML
- Include accessible labels
- Support responsive layouts
- Contain a README
- Include .env.example
- Never commit secrets
- Pass TypeScript validation before Vibld calls a task complete

## 8. Architecture

### Recommended monorepo

```text
vibld/
├── apps/
│   ├── web/
│   └── api/
│
├── packages/
│   ├── agent/
│   ├── ai/
│   ├── core/
│   ├── editor/
│   ├── git/
│   ├── preview/
│   ├── sandbox/
│   ├── templates/
│   ├── ui/
│   └── shared/
│
├── examples/
├── docs/
├── infrastructure/
├── scripts/
└── tests/
```

Recommended tooling:

- pnpm
- Turborepo
- TypeScript
- ESLint
- Prettier
- Vitest
- Playwright

## 9. Package Strategy

Use the @vibld namespace consistently.

Potential packages:

```text
@vibld/core
@vibld/agent
@vibld/ai
@vibld/sandbox
@vibld/git
@vibld/editor
@vibld/ui
@vibld/sdk
@vibld/cli
```

Avoid publishing packages until APIs actually need to be public.

An internal package can remain private inside the monorepo until that boundary proves useful.

## 10. AI Architecture

This should become one of Vibld's strongest differentiators.

Avoid one giant system prompt that receives the entire repository and blindly modifies files.

Use an orchestration model.

### Initial logical roles

#### Orchestrator

Owns the overall request.

Determines:

- user intent
- task complexity
- tools required
- context required
- execution sequence

#### Planner

Converts intent into structured implementation steps.

#### Repository Analyst

Understands:

- repository structure
- existing components
- dependencies
- conventions
- relevant files

#### UI Builder

Specializes in:

- layout
- responsive design
- components
- styling
- accessibility

#### Implementation Agent

Writes application logic.

#### Repair Agent

Receives:

- compiler errors
- runtime errors
- test failures
- browser errors

and attempts targeted correction.

#### Reviewer

Examines the resulting diff for:

- correctness
- unnecessary complexity
- broken functionality
- security issues

These may initially be logical prompt roles using the same model rather than independent autonomous agents.

## 11. AI Provider Abstraction

Vibld should not structurally depend upon one model vendor.

Create something conceptually similar to:

```text
interface VibldModelProvider {
  generate()
  stream()
  toolCall()
  structuredOutput()
}
```

Initial adapters could eventually support:

```text
@vibld/ai-openai
@vibld/ai-anthropic
@vibld/ai-google
@vibld/ai-openrouter
@vibld/ai-ollama
```

The OSS edition should support BYOK.

Vibld Cloud can offer managed model access.

## 12. Context Architecture

Repository context should be selected intelligently.

Do not continuously submit the entire codebase.

Vibld should understand:

- file tree
- imports
- exported symbols
- component relationships
- dependencies
- recent changes
- current errors
- user conversation
- project instructions

Potential future project file:

VIBLD.md

Similar in spirit to project-level AI instructions.

Example:

```markdown
# Vibld Project Instructions

Use functional React components.

Prefer shadcn/ui.

Never introduce another state library without approval.

Use the existing API client.

All new forms must be keyboard accessible.
```

## 13. Change Model

Vibld should be diff-oriented rather than regeneration-oriented.

For each meaningful task:

```text
User request
      ↓
Plan
      ↓
Relevant context
      ↓
Patch
      ↓
Build
      ↓
Test
      ↓
Repair if necessary
      ↓
Review
      ↓
Git diff
```

Users should be able to inspect:

- files changed
- additions/deletions
- reasoning summary
- validation performed

## 14. Sandbox Strategy

This deserves an Architecture Decision Record before implementation.

### Development phase

Browser-oriented sandboxes may provide the fastest MVP because they allow immediate Node execution and preview.

### Long-term abstraction

Create a sandbox interface so Vibld is not permanently tied to one execution environment.

Conceptually:

```text
interface VibldSandbox {
  create()
  writeFiles()
  execute()
  install()
  exposePort()
  snapshot()
  destroy()
}
```

Potential implementations can later include:

- Browser sandbox
- Docker
- Kubernetes
- Firecracker
- Cloud-hosted isolated workers
- Local runtime

The product must not assume one sandbox forever.

## 15. Git Architecture

Git should be built early, not bolted on later.

Projects should naturally expose:

- branches
- commits
- diffs
- rollback
- GitHub sync

A Vibld operation should eventually be capable of becoming a logical commit:

```text
feat: add opportunity kanban board
```

Future functionality:

Ask Vibld → branch → modify → test → commit → PR

That workflow is especially compelling for developers and teams.

## 16. Visual Editing

Do not build Webflow for v1.

Start with element targeting.

User clicks a rendered element.

Vibld determines:

```text
DOM element
      ↓
React component
      ↓
source file
      ↓
relevant source range
```

The user can then request:

> Make this card smaller.

or use basic controls for:

- text
- spacing
- alignment
- typography
- color

The resulting operation should still modify source code.

The code remains canonical.

## 17. Data and Backend Strategy

Avoid building a proprietary backend initially.

Instead, create adapters.

Potential integrations:

- Supabase
- Neon
- PostgreSQL
- Firebase
- Cloudflare D1
- Turso

Authentication:

- Clerk
- Supabase Auth
- Auth.js
- Better Auth

Storage:

- Cloudflare R2
- S3-compatible providers
- Supabase Storage

Vibld should understand these providers without making any of them mandatory.

## 18. Deployment Strategy

Use adapters from the beginning.

Conceptually:

```text
interface VibldDeploymentProvider {
  deploy()
  status()
  logs()
  rollback()
}
```

Potential targets:

- Cloudflare
- Vercel
- Netlify
- Railway
- Render
- Docker
- static export

A user should eventually be able to say:

> Deploy this to my Cloudflare account.

## 19. Cloudflare Strategy

Because vibld.com already lives in Cloudflare, Cloudflare is a logical default infrastructure provider without becoming a hard product dependency.

Potential Vibld infrastructure:

### Edge/API

Cloudflare Workers

### Static assets

Cloudflare's application hosting/static asset capabilities

### Object storage

R2

### Relational data

D1 where appropriate

### Coordination/state

Durable Objects

### Async workloads

Queues

### Protection

Turnstile

### DNS/domains

Cloudflare DNS

### Observability

Cloudflare logs/analytics where useful

Cloudflare should power Vibld Cloud, while OSS Vibld remains independently deployable.

## 20. Vibld OSS vs Vibld Cloud

### Vibld OSS

Should include:

- Complete primary editor
- Prompt-based generation
- Conversational editing
- Code access
- Preview
- Git integration
- BYOK AI
- Self-hosting
- Provider adapters
- Core visual targeting
- CLI
- SDK where useful

### Vibld Cloud

Can monetize convenience:

- Managed AI
- Managed sandboxes
- Persistent projects
- Hosted previews
- Deployments
- Secrets management
- Collaboration
- Teams
- Custom domains
- Usage analytics
- Organization management
- Enterprise governance
- Shared environments
- Managed integrations

Rule:

Do not intentionally cripple OSS Vibld to make Vibld Cloud attractive.

Sell operational convenience, scale and collaboration.

## 21. Licensing

### Initial recommendation

Apache License 2.0

Reasons:

- Permissive
- Commercial use permitted
- Familiar to enterprise adopters
- Explicit patent grant
- Appropriate for infrastructure/developer tooling

Alternative:

MIT

MIT is simpler and extremely common, but Apache 2.0 provides somewhat stronger protection around patent rights.

Avoid source-available licensing unless the business strategy materially changes.

## 22. Repository Strategy

Start with one canonical public repository:

github.com/vibld/vibld

Do not prematurely create ten repositories.

The monorepo can hold:

- product
- packages
- documentation
- CLI
- SDK
- infrastructure examples

Potential later repositories:

```text
vibld/examples
vibld/templates
vibld/awesome-vibld
vibld/vibld.dev
```

only when independent lifecycles justify them.

## 23. GitHub Community Setup

Initial files:

```text
README.md
LICENSE
CONTRIBUTING.md
CODE_OF_CONDUCT.md
SECURITY.md
GOVERNANCE.md
ROADMAP.md
CHANGELOG.md
VIBLD.md
```

GitHub features:

- Discussions
- Issues
- Dependabot
- Secret scanning
- CodeQL
- branch protection
- conventional commits
- release automation

Issue templates:

```text
Bug
Feature request
Integration request
Provider request
RFC
```

## 24. Documentation Structure

Eventually:

```text
vibld.com
docs.vibld.com
```

Initial documentation:

```text
Getting Started
Architecture
Self Hosting
AI Providers
Deployment Providers
Sandbox Providers
Project Configuration
CLI
Contributing
Security
```

## 25. CLI

A CLI fits Vibld extremely well.

Potential interface:

```text
npm create vibld
```

and eventually:

```text
vibld init
vibld dev
vibld build
vibld chat
vibld deploy
vibld doctor
```

The CLI should make OSS Vibld useful outside the hosted interface.

## 26. Project Format

A generated Vibld project should remain a normal application.

Optional Vibld metadata:

```text
.vibld/
├── project.json
├── history/
└── context/
```

and:

VIBLD.md

Do not place required proprietary application logic inside .vibld.

Deleting .vibld should not break the application.

## 27. Security Model

Security needs to be foundational because Vibld executes AI-generated code.

Initial principles:

- Sandboxes are untrusted.
- Generated applications cannot access Vibld control-plane credentials.
- Secrets never enter prompts unless explicitly required.
- Secrets are injected at runtime.
- Network access should eventually be policy-controlled.
- Dependency installation should be monitored.
- AI cannot silently expose secrets.
- Generated code should undergo dependency and static security checks.

Eventually introduce a dedicated security review stage.

## 28. Telemetry

OSS telemetry should be:

- transparent
- documented
- privacy-conscious
- easy to disable

Never collect source code or prompts by surprise.

This is an opportunity to build community trust.

## 29. Vibld UX

Recommended desktop structure:

```text
┌──────────────────────────────────────────────┐
│ Project / Branch / Deploy                   │
├───────────────┬──────────────────────────────┤
│               │                              │
│ Chat          │         Preview              │
│               │                              │
│               │                              │
├───────────────┼──────────────────────────────┤
│ Plan/Changes  │ Code / Console / Problems    │
└───────────────┴──────────────────────────────┘
```

Modes should emerge naturally rather than becoming different products:

### Build

Conversation-focused.

### Design

Preview-focused.

### Code

Editor-focused.

### Ship

Git/deployment-focused.

## 30. Brand Direction

### Name

Vibld

Interpretation:

Vibe + Build

That relationship does not need to be explained constantly.

### Working tagline

#### Primary

Vibe. Build. Ship.

Strong because it is:

- short
- memorable
- developer-friendly
- broader than website generation

### Positioning sentence

Vibld is the open-source AI builder for creating, editing and shipping real web applications from natural language.

### More technical version

Vibld turns natural-language intent into portable, Git-native applications using the models and infrastructure you choose.

## 31. Initial Roadmap

### Phase 0: Foundation

- Product blueprint
- Architecture decisions
- GitHub repository
- License
- Brand baseline
- Landing page
- Development environment
- Initial documentation
- Contribution model

### Phase 1: Build

Goal:

Prompt → application

Deliver:

- Project creation
- AI orchestration
- Filesystem
- Initial template
- Code generation
- Sandbox
- dependency install
- live preview

### Phase 2: Iterate

Goal:

Conversation → reliable modifications

Deliver:

- Repository context
- targeted patches
- build validation
- runtime error capture
- repair loop
- change summaries
- rollback

### Phase 3: Git

Goal:

Vibld becomes Git-native

Deliver:

- Git initialization
- diffs
- commits
- GitHub connection
- push/pull
- branch workflow

### Phase 4: Design

Goal:

Point at the interface and modify it

Deliver:

- element selection
- source mapping
- text editing
- style adjustments
- responsive inspection

### Phase 5: Full-stack

Goal:

Applications become useful products

Deliver:

- database adapters
- authentication adapters
- environment variables
- backend generation
- storage

### Phase 6: Ship

Goal:

Production deployment

Deliver:

- Cloudflare deployment
- other deployment adapters
- environment management
- logs
- custom domains

### Phase 7: Vibld Cloud

Deliver:

- accounts
- persistent projects
- hosted sandboxes
- managed AI
- billing
- teams
- collaboration

## 32. Success Metrics

Do not initially optimize for user count.

Measure whether Vibld works.

### Build completion rate

Percentage of initial prompts that produce a functioning application.

### First-preview time

Time from prompt submission to functioning preview.

### Modification success rate

Percentage of follow-up requests completed without user intervention.

### Repair rate

Percentage of generated errors Vibld resolves itself.

### Export survivability

Percentage of exported projects that build independently from Vibld.

### Human editability

Can an ordinary developer understand the generated repository?

### Retention

Do builders return and continue existing projects?

## 33. First Architecture Decision Records

Create:

```text
docs/adr/
```

Then write:

```text
0001-monorepo.md
0002-generated-app-stack.md
0003-sandbox-interface.md
0004-ai-provider-interface.md
0005-git-as-canonical-history.md
0006-cloudflare-cloud-infrastructure.md
0007-apache-2-license.md
0008-project-metadata-format.md
0009-agent-orchestration.md
0010-deployment-provider-interface.md
```

The purpose is not bureaucracy.

ADRs stop future AI coding sessions from repeatedly relitigating foundational decisions.

## 34. Initial GitHub Milestones

### M0: Foundation

- Repository bootstrapping
- Licensing
- documentation
- linting/testing
- CI
- package architecture

### M1: Hello Vibld

User enters prompt and receives generated files.

### M2: Live

Generated application executes and renders.

### M3: Iterate

Conversation modifies the running application.

### M4: Reliable

Vibld validates and repairs its own changes.

### M5: Git Native

Projects can sync cleanly to GitHub.

### M6: Visual

Users select rendered elements and change them.

### M7: Full Stack

Database/auth integrations become available.

### M8: Ship

Cloud deployment works end-to-end.

## 35. Immediate Backlog

### P0

- Create vibld/vibld
- Select Apache 2.0
- Bootstrap pnpm/Turborepo
- Create architecture skeleton
- Establish TypeScript standards
- Establish CI
- Create README
- Create contribution docs
- Create ADR framework
- Implement AI provider abstraction
- Implement sandbox abstraction
- Implement filesystem/project model
- Generate first React project
- Execute generated project
- Render preview

### P1

- Capture build errors
- Implement repair loop
- Implement targeted patches
- Implement repository indexing
- Add conversation history
- Add Git diff
- Add commits
- Add GitHub integration
- Add OpenAI provider
- Add Anthropic provider
- Add model configuration
- Add BYOK secret handling
- Add project import

### P2

- Visual element targeting
- Deployment adapter
- Cloudflare deployment
- Database adapters
- Authentication adapters
- Vibld CLI
- Template system

## 36. The First Vertical Slice

Before building authentication, billing, marketing infrastructure or integrations, Vibld should prove this exact scenario:

User opens Vibld.

User types:

> Build a modern SaaS landing page for a cybersecurity company. Include pricing, FAQ and a contact form.

Vibld:

- Creates an implementation plan.
- Generates the project.
- Installs dependencies.
- Starts the application.
- Shows the preview.
- Checks the console.
- Detects errors.
- Fixes them.
- Tells the user what it created.

User then says:

> Make the hero much simpler and change pricing from three plans to two.

Vibld:

- Identifies the correct components.
- Produces a targeted patch.
- Rebuilds.
- Verifies the preview.
- Shows the change as a Git diff.

Once that works reliably, Vibld has a product.

Everything else compounds from there.

## 37. Long-Term North Star

A future Vibld user should be able to say:

> Build this.

Then later:

> Change this.

Then:

> Why did you build it that way?

Then:

> Fix the security problems.

Then:

> Open a PR.

Then:

> Deploy it.

And at every stage the output remains recognizable, inspectable, portable software owned by the user.

That is Vibld.
