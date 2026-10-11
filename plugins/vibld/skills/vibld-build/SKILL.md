---
name: vibld-build
description: Build a new vibld website or web app, or change one with a vibld build, through vibld's MCP server. Use when the person asks to make a site, landing page or app with vibld, to start from a vibld template, or to see their vibld projects and previews.
---

# Building with vibld

vibld turns a description into a real project: a Vite single-page app with
React, TypeScript, Tailwind CSS v4, shadcn/ui on Radix, Lucide and Motion.
The code belongs to the person. They can download it, push it to GitHub and
run it anywhere, and nothing in it needs vibld to run.

A vibld build plans the page, writes a design spec (`DESIGN.md`) with exact
values for color, type, spacing and motion, writes the code, checks it
against that spec, compiles it and repairs it once if it fails. That work is
why you start a build for a new site or a large change, instead of writing
the files yourself.

## Tools

| Tool               | Use it to                                                       |
| ------------------ | --------------------------------------------------------------- |
| `list_projects`    | See the person's projects, with share links and published sites |
| `search_templates` | Find catalog designs close to a description                     |
| `start_build`      | Start a build: a new project, or a change to an existing one    |
| `get_build_status` | Follow a build until it ends                                    |
| `get_preview_url`  | Open the current code in a live preview                         |
| `take_screenshot`  | See a page of the preview at desktop, tablet or phone width     |

## Workflow

1. **Decide new or existing.** For a change to something the person already
   has, call `list_projects` and pick the project with them if the name is
   not clear. Without a `projectId`, `start_build` always makes a new
   project, so it never builds over what the person last had open.
2. **Offer a starting design when it helps.** For a new site, call
   `search_templates` with a few words about what it is for ("bakery
   landing page", "CRM dashboard"), show the person the closest ones with
   their vibld.com pages, and pass the chosen id as `templateId`. Skip this
   when the person already described the look they want.
3. **Write the prompt as the person would type it in the builder.** Carry
   over what they said about content, audience, sections, tone and style.
   Do not add requirements they did not ask for.
4. **Say what it costs before you start.** A build is billed to the
   person's plan and credit, as in the builder at https://app.vibld.com.
   Start one only when the person asked for it.
5. **Follow it.** `start_build` returns a `runId`. Call `get_build_status`
   about every 15 seconds until it is accepted, failed or stopped. A build
   takes several minutes; tell the person which phase it is in rather than
   polling silently.
6. **Show the result.** On acceptance, call `get_preview_url` (call again
   until the status is ready; a preview takes a minute or two to start) and
   give the person the link, or call `take_screenshot` to look at it
   yourself. An account runs one preview at a time, so opening one here
   replaces any preview open in the builder.
7. **On failure,** report what `get_build_status` said. Do not start the
   same build again without asking: each one is billed.

## Small changes

For a small change to an existing project (a headline, a color, one
component), edit the files directly with the `vibld-edit` skill instead of
starting a build. Editing costs no credit.

## Limits

Builds started from an assistant are limited per account (20 a day, 2 a
minute) on top of the plan's allowance. If one is refused, say which limit
was hit and that the builder at https://app.vibld.com is not affected.
