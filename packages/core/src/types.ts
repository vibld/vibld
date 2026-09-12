export type GenerationState =
  | 'idle'
  | 'planning'
  | 'staging'
  | 'validating'
  | 'accepted'
  | 'failed'
  | 'cancelled';

export interface ProjectFile {
  path: string;
  content: string;
}

export interface ProjectSnapshot {
  revision: string;
  files: ProjectFile[];
}

export interface GenerationRequest {
  prompt: string;
  base?: ProjectSnapshot;
}

export interface GenerationPlan {
  summary: string;
  files: ProjectFile[];
}

export interface ModelProvider {
  readonly id: string;
  generate(request: GenerationRequest): Promise<GenerationPlan>;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  /**
   * Problems worth telling the user about that do not justify throwing the
   * run away. A page whose body text sits at 4.2:1 is a real accessibility
   * defect and still a working project; rejecting it would cost the user
   * their generation and the money it took, to fix something they can see
   * and decide about. Optional, so a validator that has nothing to say
   * stays exactly as it was.
   */
  warnings?: string[];
}

export type Validator = (
  snapshot: ProjectSnapshot,
) => Promise<ValidationResult>;

export interface GenerationResult {
  state: GenerationState;
  accepted?: ProjectSnapshot;
  staged?: ProjectSnapshot;
  errors: string[];
  /**
   * The model's own description of what it built, once a plan has landed.
   * Absent for a run that never reached `provider.generate()`'s return (a
   * failure before then has nothing to describe). Carried on every result
   * from that point on -- including a validation failure or a cancellation --
   * so a caller showing "what was this run" never loses it partway through.
   */
  summary?: string;
  /**
   * Carried through from validation. Unlike `errors` these do not change
   * the state: a result can be `accepted` and still have warnings.
   */
  warnings?: string[];
}
