# The vibld plugin

vibld's MCP server and two skills, for Claude Code, Codex, Cursor and
OpenCode. With it installed, your coding agent can start vibld builds,
follow them, and read, change, type-check and screenshot the code of your
vibld projects (D207).

- **MCP server:** `https://app.vibld.com/mcp`. The first call opens a
  browser window to sign in to vibld; after that the agent stays connected.
  See [docs/mcp-server.md](../../docs/mcp-server.md).
- **Skills:** `vibld-build` (new sites and large changes, as builds) and
  `vibld-edit` (direct edits, checks, screenshots and undo).

Builds are billed to your vibld plan and credit as in the builder. Editing
costs no credit and counts toward your plan's daily editing calls.

## Install

The marketplace is this repository: `https://github.com/vibld/vibld`.

### Claude Code

```
/plugin marketplace add vibld/vibld
/plugin install vibld@vibld
```

In the Claude desktop app: **Claude Code**, **Customize**, **+** beside
**Personal Plugins**, **Add marketplace**, **Add from a repository**, paste
`https://github.com/vibld/vibld`, **Sync**, then install **vibld**.

### Codex

**Plugins** panel, **Add more**, source `https://github.com/vibld/vibld`,
**Save**, then install **vibld**. In a chat, type `@vibld`.

### Cursor

Agent window, **Settings**, **Plugins**, paste
`https://github.com/vibld/vibld` into the search field and install
**vibld**.

### OpenCode

Add the server to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "vibld": {
      "type": "remote",
      "url": "https://app.vibld.com/mcp",
      "enabled": true
    }
  }
}
```

Then copy `plugins/vibld/skills/` into `~/.config/opencode/skills/`.

## Files

| Path                                                                                    | For                       |
| --------------------------------------------------------------------------------------- | ------------------------- |
| `/.claude-plugin/marketplace.json`                                                      | Claude Code's marketplace |
| `/.agents/plugins/marketplace.json`                                                     | Codex's marketplace       |
| `/.cursor-plugin/marketplace.json`                                                      | Cursor's marketplace      |
| `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.cursor-plugin/plugin.json` | The plugin, per agent     |
| `.mcp.json` (Claude Code, Codex), `mcp.json` (Cursor)                                   | The server                |
| `skills/*/SKILL.md`                                                                     | The skills                |

`apps/web/test/agent-plugin.test.ts` checks that the manifests agree on
name, version and license, that every config points at the hosted server,
and that the skills name only tools the server offers. Bump `version` in
all four places that carry it when the plugin changes.
