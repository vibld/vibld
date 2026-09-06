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
}

export type Validator = (snapshot: ProjectSnapshot) => Promise<ValidationResult>;

export interface GenerationResult {
  state: GenerationState;
  accepted?: ProjectSnapshot;
  staged?: ProjectSnapshot;
  errors: string[];
}
