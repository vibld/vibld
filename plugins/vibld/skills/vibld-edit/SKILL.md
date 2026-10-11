---
name: vibld-edit
description: Read and change the code of an existing vibld project directly, type-check it, look at it in a browser, and undo changes through vibld's MCP server. Use for targeted edits to a vibld site or app (copy, styles, a component, a bug fix) and for restoring an earlier version.
---

# Editing a vibld project

Every vibld project is a plain Vite, React, TypeScript and Tailwind CSS v4
app. These tools change its code in place, with no build: each write becomes
the project's current code at once, as a new checkpoint the person can undo.
Editing costs no credit; each call counts toward the plan's daily editing
calls (Free 50, Build 500, Ship 2,000), reads as much as writes.

## Tools

| Tool                 | Use it to                                                    |
| -------------------- | ------------------------------------------------------------ |
| `list_projects`      | Find the project to edit and its `projectId`                 |
| `list_files`         | List the files and the revision they are at                  |
| `read_files`         | Read up to 20 files, from the current code or a checkpoint   |
| `write_files`        | Write up to 20 files and delete up to 20, against a revision |
| `check_types`        | Type-check the current code in the live preview              |
| `take_screenshot`    | See a page at 1280 (desktop), 768 (tablet) or 390 (phone)    |
| `get_logs`           | The preview's state and how recent builds ended              |
| `list_checkpoints`   | Every revision the code has been at, newest first            |
| `restore_checkpoint` | Make an earlier checkpoint the current code again            |

## Workflow

1. **Find the project.** Every editing tool needs a `projectId`. Call
   `list_projects` and match the site the person named; if more than one
   could be it, or none clearly is, ask them which.
2. **Find the files.** `list_files` gives every path, its size and the
   current `revision`. Keep that revision: `write_files` needs it.
3. **Read before writing.** `read_files` the files you will change and the
   ones they import. Read `DESIGN.md` too: it is the project's design spec,
   with the exact colors, fonts, spacing and motion the code was built to.
   Keep to its values, or update it in the same write when the person asks
   for a different look.
4. **Write whole files.** Each entry in `files` replaces the file at its
   path with the full new content. Pass the revision you read as
   `baseRevision`.
5. **Check.** Run `check_types` after every write (call again until the
   preview is ready) and fix what the compiler reports. Then look at the
   page with `take_screenshot`, at phone width as well as desktop when the
   change affects layout.
6. **Tell the person** what changed, and that the previous version is one
   `restore_checkpoint` away.

## When a write is refused

- **`checkpoint-moved`:** the project changed since you read it, for
  example in the builder. Nothing was written. Read the files again at the
  revision the error names and redo the change on top of them; do not write
  your old content over theirs.
- **A build is running:** wait for it to end (`get_logs` shows how recent
  builds ended), then read again.
- **Limits:** a project holds at most 50 files and 160,000 characters, so
  it can still be built on. `read_files` returns at most 100,000 characters
  a call: a file left out is named in `omitted`, and a very long file comes
  back in parts, read alone with `offset` set to each part's `nextOffset`.

## Rules for the code

- Stay on the stack: React, TypeScript, Tailwind CSS v4 utilities and
  theme variables, shadcn/ui components on Radix, `lucide-react` icons,
  `motion/react` for animation. Do not add other dependencies unless the
  person asks.
- Keep the project portable. Nothing may import from `.vibld/` or need
  vibld to run.
- Leave files that carry the comment "Written by Vibld" (backgrounds and
  the 3D stage) as they are; vibld maintains them.
- Never put an API key, token or password in source. Read it from an
  environment variable (`import.meta.env.VITE_...`) and tell the person to
  set it.

## Undo

`list_checkpoints` shows each revision, what made it (a build, a repair, an
edit, a restore) and which is current. `restore_checkpoint` with that
revision and the current one as `baseRevision` puts it back. The code it
replaces stays in the history, so a restore can itself be undone.

## Larger changes

For a new page, a redesign or anything that would rewrite most of the
project, use the `vibld-build` skill and start a build: it plans, writes
the design spec and checks the result.
