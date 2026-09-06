import type {
  GenerationRequest,
  GenerationResult,
  GenerationState,
  ModelProvider,
  ProjectSnapshot,
  Validator,
} from "./types.js";

function revisionFor(snapshot: Omit<ProjectSnapshot, "revision">): string {
  const payload = JSON.stringify(snapshot.files);
  let hash = 2166136261;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `r${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export class GenerationMachine {
  #state: GenerationState = "idle";
  #accepted?: ProjectSnapshot;
  #staged?: ProjectSnapshot;
  #cancelled = false;

  get state(): GenerationState {
    return this.#state;
  }

  get accepted(): ProjectSnapshot | undefined {
    return this.#accepted ? structuredClone(this.#accepted) : undefined;
  }

  cancel(): void {
    this.#cancelled = true;
  }

  async run(
    request: GenerationRequest,
    provider: ModelProvider,
    validator: Validator,
  ): Promise<GenerationResult> {
    this.#cancelled = false;
    this.#state = "planning";

    try {
      const plan = await provider.generate({
        ...request,
        base: request.base ?? this.#accepted,
      });

      if (this.#cancelled) {
        return this.#cancelledResult();
      }

      this.#state = "staging";
      const files = plan.files.map((file) => ({ ...file }));
      const stagedWithoutRevision = { files };
      this.#staged = {
        ...stagedWithoutRevision,
        revision: revisionFor(stagedWithoutRevision),
      };

      if (this.#cancelled) {
        return this.#cancelledResult();
      }

      this.#state = "validating";
      const validation = await validator(structuredClone(this.#staged));

      if (this.#cancelled) {
        return this.#cancelledResult();
      }

      if (!validation.ok) {
        this.#state = "failed";
        return {
          state: this.#state,
          accepted: this.accepted,
          staged: structuredClone(this.#staged),
          errors: [...validation.errors],
        };
      }

      this.#accepted = structuredClone(this.#staged);
      this.#state = "accepted";

      return {
        state: this.#state,
        accepted: this.accepted,
        staged: structuredClone(this.#staged),
        errors: [],
      };
    } catch (error) {
      this.#state = "failed";
      return {
        state: this.#state,
        accepted: this.accepted,
        staged: this.#staged ? structuredClone(this.#staged) : undefined,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  #cancelledResult(): GenerationResult {
    this.#state = "cancelled";
    return {
      state: this.#state,
      accepted: this.accepted,
      staged: this.#staged ? structuredClone(this.#staged) : undefined,
      errors: [],
    };
  }
}
