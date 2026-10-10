---
name: vibld
description: Find your way around vibld, the AI application builder at vibld.com. Use when a person asks what vibld is, what it costs, which design templates and styles it has, how to use the builder, how to take a project out of it, how to call its API, or how to run their own copy.
---

# Using vibld

vibld (pronounced "vibe-build") turns a conversation into a working web
project and writes it as a conventional codebase the person owns. The
builder is at https://app.vibld.com; vibld.com describes it.

## Read the site as Markdown

Every page on vibld.com is also available as Markdown: send
`Accept: text/markdown`, or add `.md` to the path (`/pricing.md`,
`/index.md` for the home page). Start with:

- https://vibld.com/llms.txt: what vibld is, the main pages, and answers to
  common questions.
- https://vibld.com/llms-full.txt: the longer version.

## Answer common questions from the right page

- What it costs, plans and credits: https://vibld.com/pricing and
  https://vibld.com/docs/credits-and-plans
- How a build works: https://vibld.com/how-it-works
- Design templates a project can start from: https://vibld.com/templates,
  grouped into categories under `/templates/<category>`, each design at
  `/templates/<id>`
- Visual styles: https://vibld.com/styles and the style gallery at
  https://vibld.com/styles/gallery
- Examples of generated projects: https://vibld.com/examples
- Terms, privacy and licenses: https://vibld.com/legal

Quote prices and plan limits from the page, not from memory: they change.

## Help someone use the builder

1. Sign up or sign in at https://app.vibld.com/sign-up. vibld does not
   create accounts for agents.
2. Describe the site or app in the conversation; the builder plans it,
   builds it, and shows a live preview.
3. Take the code out with Export, Push to GitHub or Publish
   (https://vibld.com/docs/taking-your-code).

The guides for each part are listed at https://vibld.com/docs.

## Call the API

The builder runs on an HTTP API described by an OpenAPI 3.1 document at
https://app.vibld.com/api/openapi.json, listed in vibld.com's API catalog at
https://vibld.com/.well-known/api-catalog. Requests sign in with the Clerk
session token of a person signed in at app.vibld.com
(`Authorization: Bearer`); there are no API keys. How sign-in works is in
https://vibld.com/auth.md and https://vibld.com/docs/api.

## Run your own copy

The source is published at https://github.com/vibld/vibld. Running it on
your own Cloudflare account and model keys is covered by:

- https://vibld.com/docs/self-hosting
- https://vibld.com/docs/configuration
- https://vibld.com/docs/deploying
- https://vibld.com/docs/hosted-vs-self-hosted

For what the license allows, point the person to
https://vibld.com/legal/licenses rather than summarizing it.
