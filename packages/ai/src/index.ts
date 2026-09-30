export { createAnthropicPlanClient } from './anthropic-client.ts';
export type { AnthropicPlanClientOptions } from './anthropic-client.ts';
export {
  PlanProvider,
  DEFAULT_EFFORT,
  DEFAULT_MAX_TOKENS,
  RUN_OUTPUT_RESERVE_MICRO_USD,
  RUN_WALL_CLOCK_BUDGET_MS,
  RUN_STEP_TIMEOUT_MS,
  RUN_ABANDONED_AFTER_MS,
  MEASURED_OUTPUT_TOKENS_PER_SECOND,
  affordableOutputTokens,
  maxTokensFor,
  outputTokensPerSecondFor,
  readCompletion,
  MOCKUP_OUTPUT_TOKENS,
  mockupMaxTokensFor,
  CHAT_EFFORT,
  CHAT_OUTPUT_TOKENS,
  chatMaxTokensFor,
  DEFAULT_MODEL,
  buildUserPrompt,
  chosenMockupSection,
  mediaSection,
} from './plan-provider.ts';
export type {
  MediaManifestEntry,
  ModelProviderOptions,
} from './plan-provider.ts';
export type {
  PlanClient,
  PlanCompletion,
  PlanEffort,
  PlanProgress,
  PlanRefusal,
  PlanRequest,
  PlanUsage,
} from './client.ts';
export {
  BOUNDED_RUN_MAX_OUTPUT_TOKENS,
  BoundedBuilder,
  BoundedPlanProvider,
  DEFAULT_BOUNDED_INPUT_CHARS,
  buildOutputBudgetFor,
  GROUP_CONTEXT_MAX_CHARS,
  GROUP_ESTIMATE_TOKENS,
  GROUP_MAX_TOKENS,
  MAX_PLANNED_FILES,
  MIN_CALL_TOKENS,
  MODEL_REQUIRED_FILES,
  OUTLINE_LABEL,
  OUTLINE_MAX_TOKENS,
  OUTLINE_RETRY_MAX_TOKENS,
  SIZE_ESTIMATE_TOKENS,
  applyBoundedPatch,
  callCeilingFor,
  describeGroup,
  estimateTokens,
  groupLabel,
  groupPrompt,
  normaliseOutline,
  orderManifest,
  partitionManifest,
  rankOf,
  runBoundedBuild,
  splitGroup,
  stepOf,
} from './bounded-build.ts';
export type {
  BaseSource,
  BoundedBuildBudget,
  BoundedBuildHooks,
  BoundedBuildInput,
  BoundedBuildResult,
  BoundedBuilderOptions,
  BoundedPatch,
  BoundedPlanProviderOptions,
  CallLimits,
  CallRecord,
  GroupInput,
  NormalisedOutline,
  OutlineValue,
  StartedCall,
} from './bounded-build.ts';
export {
  createScriptedBuildClient,
  requestedPaths,
} from './scripted-client.ts';
export type {
  ScriptedBuild,
  ScriptedClient,
  ScriptedClientOptions,
  ScriptedFile,
} from './scripted-client.ts';
export {
  BoundedBuildError,
  CHAT_SUBJECT,
  ProviderContextError,
  ProviderError,
  ProviderRefusalError,
  ProviderShapeError,
  ProviderTruncationError,
} from './errors.ts';
export {
  BuildOutlineReadSchema,
  BuildOutlineSchema,
  DependencySchema,
  FileGroupSchema,
  GROUP_SYSTEM_PROMPT,
  GenerationPlanReadSchema,
  GenerationPlanSchema,
  MANIFEST_SIZES,
  MAX_PLANNED_ROUTES,
  ManifestEntrySchema,
  OUTLINE_SYSTEM_PROMPT,
  PLAN_SYSTEM_PROMPT,
  ProjectFileSchema,
  REQUIRED_PROJECT_FILES,
} from './plan-schema.ts';
export type {
  BuildOutline,
  ManifestEntry,
  ManifestSize,
} from './plan-schema.ts';
export {
  DESIGN_MD_PATH,
  DesignSpecSchema,
  MAX_MOCKUP_MEASURE_CHARS,
  measureDesign,
  measureMockup,
  readDesignSpec,
  renderDesignMd,
} from './design-spec.ts';
export type { DesignSpec } from './design-spec.ts';
export {
  MAX_FINDINGS_IN_PROMPT,
  checkDesign,
  describeFindings,
  normalizeCssValue,
} from './design-checks.ts';
export type {
  DesignFinding,
  DesignReport,
  FindingSeverity,
} from './design-checks.ts';
export { keepingRecordOf, repairPromptFor, withRecordOf } from './repair.ts';
export type { ParsedGenerationPlan } from './plan-schema.ts';
export {
  DRAFT_MOCKUP_STYLE_PREAMBLE,
  DRAFT_MOCKUP_SYSTEM_PROMPT,
  DraftMockupSetSchema,
  MAX_MOCKUP_LABEL_CHARS,
  MOCKUP_STYLE_PREAMBLE,
  MOCKUP_SYSTEM_PROMPT,
  MockupSchema,
  MockupSetSchema,
  mockupUserPrompt,
} from './mockup-schema.ts';
export type { ParsedMockup, ParsedMockupSet } from './mockup-schema.ts';
export {
  CHAT_SYSTEM_PROMPT,
  ChatDecisionSchema,
  chatUserPrompt,
  toChatTurn,
} from './chat-schema.ts';
export type {
  ChatMessage,
  ChatProjectContext,
  ChatRole,
  ChatTurn,
  ParsedChatDecision,
} from './chat-schema.ts';
export { ChatProvider } from './chat-provider.ts';
export type { ChatProviderOptions, ChatRequest } from './chat-provider.ts';
export {
  CHAT_JSON_INSTRUCTION,
  CHAT_OUTPUT,
  DRAFT_MOCKUP_JSON_INSTRUCTION,
  DRAFT_MOCKUP_OUTPUT,
  FILE_GROUP_JSON_INSTRUCTION,
  FILE_GROUP_OUTPUT,
  OUTLINE_JSON_INSTRUCTION,
  OUTLINE_OUTPUT,
  MOCKUP_JSON_INSTRUCTION,
  MOCKUP_OUTPUT,
  PLAN_JSON_INSTRUCTION,
  PLAN_OUTPUT,
  jsonSchemaFor,
  outputFor,
} from './plan-output.ts';
export type { PlanOutput } from './plan-output.ts';
export { MockupProvider } from './mockup-provider.ts';
export type {
  MockupProviderOptions,
  MockupRequest,
} from './mockup-provider.ts';
export {
  STYLE_PRESETS,
  findStylePreset,
  isStylePresetId,
  styleDirection,
} from './style-presets.ts';
export type {
  StylePreset,
  StylePresetId,
  StyleTokens,
} from './style-presets.ts';
export {
  AA_LARGE_TEXT,
  AA_NORMAL_TEXT,
  contrastRatio,
  findContrastFailures,
  meetsAA,
  parseHex,
  readRootTokens,
  relativeLuminance,
} from './contrast.ts';
export type { ContrastFinding } from './contrast.ts';
export {
  MARKETING_PAGE_PATTERNS,
  SAAS_SCREEN_PATTERNS,
  patternGuidance,
  selectPatterns,
} from './patterns.ts';
export type { PagePattern } from './patterns.ts';
export {
  MOTION_RECIPES,
  findMotionRecipe,
  motionGuidance,
  selectMotion,
} from './motion.ts';
export type { MotionRecipe } from './motion.ts';
export {
  SURFACE_TECHNIQUES,
  findSurfaceTechnique,
  selectSurfaces,
  surfaceGuidance,
} from './surfaces.ts';
export type { SurfaceTechnique } from './surfaces.ts';
export {
  DIAGRAM_CRAFT,
  DIAGRAM_TYPES,
  diagramGuidance,
  findDiagramType,
  selectDiagrams,
} from './diagrams.ts';
export type { DiagramType } from './diagrams.ts';
export {
  PRIMITIVE_BASICS,
  PRIMITIVE_RECIPES,
  findPrimitive,
  primitiveGuidance,
  selectPrimitives,
} from './primitives.ts';
export type { PrimitiveRecipe } from './primitives.ts';
export {
  PRODUCT_PALETTES,
  findPalette,
  paletteGuidance,
  selectPalette,
} from './palettes.ts';
export type { ProductPalette } from './palettes.ts';
export {
  STYLE_DIMENSIONS,
  encodeStyleDna,
  findDimension,
  sanitizeStyleDna,
  styleDnaGuidance,
} from './style-dna.ts';
export type {
  StyleDimension,
  StyleDimensionId,
  StyleDna,
  StyleOption,
} from './style-dna.ts';
export {
  MAX_BASE_CONTENT_CHARS,
  MAX_KNOWLEDGE_CHARS,
  MAX_CHOSEN_MOCKUP_CHARS,
  MAX_CHOSEN_MOCKUP_SECTION_CHARS,
  MAX_MOCKUP_DIRECTION_CHARS,
  MAX_MOCKUP_FIXED_PROMPT_CHARS,
  MAX_BUILD_FIXED_PROMPT_CHARS,
  MAX_MEDIA_ENTRIES,
  MAX_MEDIA_SECTION_CHARS,
} from './limits.ts';
export {
  createDeepseekPlanClient,
  DEEPSEEK_BASE_URL,
  JSON_MODE_INSTRUCTION,
  mapFinishReason,
  readCompletionStream,
  readJsonPlan,
} from './deepseek-client.ts';
export type { DeepseekPlanClientOptions } from './deepseek-client.ts';
export {
  createOpenaiPlanClient,
  mapResponseStatus,
  OPENAI_BASE_URL,
  planJsonSchema,
  readOutputText,
  readRefusal,
  readResponseStream,
} from './openai-client.ts';
export type { OpenaiPlanClientOptions } from './openai-client.ts';
export {
  DEFAULT_MODELS,
  configuredProviders,
  createPlanClient,
  defaultModelFor,
  providerForRequest,
  resolveModel,
  selectProvider,
} from './select-client.ts';
export { PROVIDER_NAMES } from './select-client.ts';
export type { ProviderEnv, ProviderName } from './select-client.ts';
export {
  CATALOGUE_VERIFIED_ON,
  LEGACY_MODEL_IDS,
  MAX_CATALOGUE_AGE_DAYS,
  MODEL_CATALOGUE,
  PROVIDER_CACHE_RATES,
  availableModels,
  catalogueAgeDays,
  cacheRatesFor,
  canonicalModelId,
  findModel,
  isKnownModel,
} from './model-catalogue.ts';
export type { CacheRates, ModelChoice } from './model-catalogue.ts';
export { allowedModels, grantedIds, parseModelPolicy } from './model-policy.ts';
export type { ModelPolicy, PolicyParse } from './model-policy.ts';
export {
  hexToHsl,
  hslToHex,
  normaliseHue,
  readableOn,
  shadeAgainst,
  shadeMeeting,
  shiftLightness,
} from './color-space.ts';
export type { Hsl } from './color-space.ts';
export {
  REQUIRED_PAIRS,
  derivePalette,
  paletteFailures,
  seedFromHex,
} from './palette-derive.ts';
export type {
  DerivedPalette,
  PaletteColors,
  PaletteMode,
  PaletteScheme,
  PaletteSeed,
} from './palette-derive.ts';
export {
  PALETTE_LIBRARY,
  findLibraryPalette,
  matchLibraryPalette,
  paletteSummaries,
} from './palette-library.ts';
export {
  dominantBrandColor,
  paletteFromPage,
  readColorLiterals,
  readPageColors,
  sameOriginStylesheets,
} from './palette-extract.ts';
export type {
  ExtractedPalette,
  PageColors,
  Stylesheet,
} from './palette-extract.ts';
export {
  MAX_SNAPSHOT_AGE_DAYS,
  MIN_REALISED_TOKENS,
  PUBLISHED_PROVIDERS,
  RATE_TOLERANCE,
  TOKEN_KINDS,
  anthropicRealisedRates,
  billedRates,
  comparePublished,
  compareRealised,
  openaiLineItem,
  openaiRealisedRates,
  parsePublishedPrices,
  parsePublishedSnapshot,
  planMargin,
  worstCostRatio,
} from './price-check.ts';
export type {
  PlanEconomics,
  PriceFinding,
  PriceFindingKind,
  PublishedPrice,
  Rates,
  RealisedRate,
  RealisedReading,
  TokenKind,
} from './price-check.ts';
export {
  compareVersions,
  familyDefaultFor,
  familyOf,
  groupByFamily,
} from './model-families.ts';
export type { FamilyGroup, ModelFamily } from './model-families.ts';
export {
  anthropicServedModel,
  compareServed,
  listedModels,
} from './served-check.ts';
export type { ServedFinding, ServedModel } from './served-check.ts';
export {
  OPTIONAL_PACKAGES,
  STACK_PACKAGES,
  stackDependencies,
  stackVersionLine,
} from './stack.ts';
export type { StackPackage } from './stack.ts';
export {
  MAIN_TSX,
  PROJECT_SCRIPTS,
  SCAFFOLD_PATHS,
  SCAFFOLD_SECTION,
  TSCONFIG,
  UTILS_TS,
  VITE_CONFIG,
  extraDependencies,
  importedPackages,
  isScaffoldPath,
  scaffoldFiles,
  scaffoldText,
  withImportedDependencies,
  withScaffold,
} from './scaffold.ts';
export type {
  ExtraDependency,
  ScaffoldInput,
  ScaffoldPath,
} from './scaffold.ts';
export { TOKEN_USE, tokenCss } from './theme-css.ts';
export type { ColorTokens, ShapeTokens } from './theme-css.ts';
