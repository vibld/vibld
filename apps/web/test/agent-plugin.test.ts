import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { TOOLS } from '../worker/mcp-server.ts';

/**
 * The vibld plugin for Claude Code, Codex and Cursor (D207): three
 * marketplace manifests at the repository root, one plugin under
 * plugins/vibld. The public repository is the marketplace, so these files
 * reach people as they are; what this checks is that they agree with each
 * other and with the server they point at.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const PLUGIN = join(ROOT, 'plugins', 'vibld');
const ENDPOINT = 'https://app.vibld.com/mcp';

function json(path: string): Record<string, any> {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
}

const pluginManifests = {
  claude: json('plugins/vibld/.claude-plugin/plugin.json'),
  codex: json('plugins/vibld/.codex-plugin/plugin.json'),
  cursor: json('plugins/vibld/.cursor-plugin/plugin.json'),
};

describe('the vibld agent plugin', () => {
  it('is listed by each marketplace at plugins/vibld', () => {
    const claude = json('.claude-plugin/marketplace.json');
    const cursor = json('.cursor-plugin/marketplace.json');
    const codex = json('.agents/plugins/marketplace.json');
    assert.deepEqual(
      claude.plugins.map((p: any) => [p.name, p.source]),
      [['vibld', './plugins/vibld']],
    );
    assert.deepEqual(
      cursor.plugins.map((p: any) => [p.name, p.source]),
      [['vibld', './plugins/vibld']],
    );
    assert.deepEqual(
      codex.plugins.map((p: any) => [p.name, p.source.path]),
      [['vibld', './plugins/vibld']],
    );
  });

  it('carries one name, version and license in every manifest', () => {
    const versions = new Set(
      Object.values(pluginManifests).map((m) => m.version),
    );
    assert.equal(versions.size, 1, `versions differ: ${[...versions]}`);
    for (const manifest of Object.values(pluginManifests)) {
      assert.equal(manifest.name, 'vibld');
      assert.equal(manifest.license, 'Apache-2.0');
    }
  });

  // Cursor's schemas (github.com/cursor/plugins, schemas/) refuse any key
  // they do not list, so metadata lives in plugin.json alone.
  it("keeps to the keys Cursor's schemas allow", () => {
    const marketplace = json('.cursor-plugin/marketplace.json');
    for (const entry of marketplace.plugins) {
      for (const key of Object.keys(entry)) {
        assert.ok(
          ['name', 'source', 'description', 'minClientVersions'].includes(key),
          `marketplace entry key ${key}`,
        );
      }
    }
    assert.deepEqual(Object.keys(marketplace.owner).sort(), ['email', 'name']);
    assert.deepEqual(Object.keys(pluginManifests.cursor.author).sort(), [
      'email',
      'name',
    ]);
  });

  it('points every MCP config at the hosted server', () => {
    for (const path of ['plugins/vibld/.mcp.json', 'plugins/vibld/mcp.json']) {
      const servers = Object.values(json(path).mcpServers) as { url: string }[];
      assert.deepEqual(
        servers.map((s) => s.url),
        [ENDPOINT],
        path,
      );
    }
  });

  it('names only files that exist', () => {
    const codex = pluginManifests.codex;
    for (const path of [
      codex.interface.logo,
      codex.interface.composerIcon,
      codex.mcpServers,
      pluginManifests.claude.icon,
      pluginManifests.cursor.logo,
    ]) {
      assert.doesNotThrow(() => readFileSync(join(PLUGIN, path)), path);
    }
  });

  it("names only the server's own tools in its skills", () => {
    const tools = new Set<string>(TOOLS.map((t) => t.name));
    const skills = readdirSync(join(PLUGIN, 'skills'));
    assert.deepEqual(skills.sort(), ['vibld-build', 'vibld-edit']);
    for (const skill of skills) {
      const text = readFileSync(
        join(PLUGIN, 'skills', skill, 'SKILL.md'),
        'utf8',
      );
      const name = /^name: (.+)$/m.exec(text)?.[1];
      assert.equal(name, skill, `${skill}'s frontmatter name`);
      // A tool is written in backticks and has an underscore; field names
      // such as `projectId` and `baseRevision` have none.
      const named = [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map(
        (m) => m[1],
      );
      assert.ok(named.length > 0, skill);
      for (const tool of named) {
        assert.ok(
          tools.has(tool),
          `${skill} names ${tool}, which /mcp does not offer`,
        );
      }
    }
  });
});
