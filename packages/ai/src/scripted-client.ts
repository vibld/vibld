import type {
  PlanClient,
  PlanCompletion,
  PlanEffort,
  PlanRequest,
  PlanUsage,
} from './client.ts';
import type { DesignSpec } from './design-spec.ts';
import { CHARS_PER_OUTPUT_TOKEN } from './limits.ts';
import { outputFor } from './plan-output.ts';
import type { ManifestSize } from './plan-schema.ts';

/**
 * A model that answers a bounded build from a script, for tests and for
 * anything else that must exercise the real orchestration without a network
 * or a key. The `FakeModelProvider` of `@vibld/core` stands in for a whole
 * provider; this stands in for the service behind a `PlanClient`, so the
 * prompts, the partition, the splitting and the budget are all real.
 *
 * It behaves the way the failure it exists to reproduce behaved: a reply is
 * measured at four characters a token, and a reply longer than the call's
 * output ceiling comes back cut off (`stop_reason: max_tokens`, no plan),
 * whichever kind of request it was. So a script too large for one response
 * truncates when asked for as one (`PLAN_OUTPUT`), and completes when asked
 * for in bounded steps.
 */

/** One file of the scripted project, as the outline will plan it. */
export interface ScriptedFile {
  path: string;
  content: string;
  size?: ManifestSize;
  dependsOn?: string[];
  purpose?: string;
}

export interface ScriptedBuild {
  summary: string;
  spec?: DesignSpec;
  files: ScriptedFile[];
  /** Existing paths the outline removes, on a follow-up. */
  delete?: string[];
}

export interface ScriptedClientOptions {
  /**
   * Paths a group reply leaves out the first time it is asked for them, to
   * exercise what happens when a model skips a file.
   */
  omitOnce?: readonly string[];
  /** Answer a request of this output kind with a refusal. */
  refuse?: 'build_outline' | 'file_group';
  /** Answer the first request of this kind with something unreadable. */
  malformOnce?: 'build_outline' | 'file_group';
  /**
   * Output tokens spent thinking before the answer, by the effort asked
   * for, as a reasoning model spends them: billed as output and counted
   * against the call's ceiling, so enough of it truncates an answer that
   * would otherwise fit. None where an effort is not named.
   */
  thinking?: Partial<Record<PlanEffort, number>>;
}

export interface ScriptedClient extends PlanClient {
  /** Every request, in the order it was made. */
  readonly requests: PlanRequest[];
}

/** The paths a file-group prompt asks for, read back from its last line. */
export function requestedPaths(prompt: string): string[] {
  const match =
    /Write exactly these files, and no other, each complete: (\[.*\])\s*$/.exec(
      prompt,
    );
  if (!match) return [];
  const parsed: unknown = JSON.parse(match[1]!);
  return Array.isArray(parsed)
    ? parsed.filter((path): path is string => typeof path === 'string')
    : [];
}

export function createScriptedBuildClient(
  build: ScriptedBuild,
  options: ScriptedClientOptions = {},
): ScriptedClient {
  const requests: PlanRequest[] = [];
  const omitted = new Set(options.omitOnce ?? []);
  const cached = new Set<string>();
  let malformed = false;

  return {
    id: 'scripted',
    requests,
    async createPlan(request: PlanRequest): Promise<PlanCompletion> {
      requests.push(request);
      const kind = outputFor(request).name;
      let reply: unknown;
      if (kind === 'build_outline') {
        reply = {
          summary: build.summary,
          ...(build.spec ? { spec: build.spec } : {}),
          manifest: build.files.map((file) => ({
            path: file.path,
            purpose: file.purpose ?? `The file at ${file.path}.`,
            dependsOn: file.dependsOn ?? [],
            size: file.size ?? 'small',
          })),
          delete: build.delete ?? [],
        };
      } else if (kind === 'file_group') {
        const wanted = requestedPaths(request.prompt);
        const files = build.files.filter((file) => {
          if (!wanted.includes(file.path)) return false;
          if (omitted.has(file.path)) {
            omitted.delete(file.path);
            return false;
          }
          return true;
        });
        reply = {
          files: files.map((file) => ({
            path: file.path,
            content: file.content,
          })),
        };
      } else {
        reply = {
          summary: build.summary,
          ...(build.spec ? { spec: build.spec } : {}),
          files: build.files.map((file) => ({
            path: file.path,
            content: file.content,
          })),
        };
      }

      const prefix = request.cachePrefix ?? '';
      const promptTokens = Math.ceil(
        (request.system.length + prefix.length + request.prompt.length) /
          CHARS_PER_OUTPUT_TOKEN,
      );
      // A prefix seen before is read from the cache, as Anthropic reads a
      // marked one: the first call writes it, every later call reads it.
      const prefixTokens = Math.ceil(prefix.length / CHARS_PER_OUTPUT_TOKEN);
      const hit = prefix.length > 0 && cached.has(prefix);
      if (prefix.length > 0) cached.add(prefix);

      const text = JSON.stringify(reply);
      const thinking = options.thinking?.[request.effort] ?? 0;
      const needed = thinking + Math.ceil(text.length / CHARS_PER_OUTPUT_TOKEN);
      const truncated = needed > request.maxTokens;
      request.onProgress?.({
        characters: truncated
          ? Math.max(0, request.maxTokens - thinking) * CHARS_PER_OUTPUT_TOKEN
          : text.length,
        ...(thinking > 0
          ? {
              reasoningCharacters:
                Math.min(thinking, request.maxTokens) * CHARS_PER_OUTPUT_TOKEN,
            }
          : {}),
      });
      const usage: PlanUsage = {
        inputTokens: promptTokens,
        outputTokens: Math.min(needed, request.maxTokens),
        cacheReadInputTokens: hit ? prefixTokens : 0,
        cacheWriteInputTokens: !hit && prefix.length > 0 ? prefixTokens : 0,
      };

      if (options.refuse === kind) {
        return {
          plan: null,
          stopReason: 'refusal',
          refusal: { category: 'scripted', explanation: 'declined' },
          usage,
        };
      }
      if (options.malformOnce === kind && !malformed) {
        malformed = true;
        return { plan: { unexpected: true }, stopReason: 'end_turn', usage };
      }
      if (truncated) {
        return { plan: null, stopReason: 'max_tokens', usage };
      }
      return { plan: reply, stopReason: 'end_turn', usage };
    },
  };
}
