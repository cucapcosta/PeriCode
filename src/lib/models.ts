/**
 * Centralized model definitions for Claude models.
 * This is the single source of truth for available models.
 */

export interface ModelDefinition {
  id: string;           // Full model ID (e.g., "claude-opus-4-6")
  alias: string;        // Short alias for CLI (e.g., "opus")
  family: "opus" | "sonnet" | "haiku";
  version: string;      // e.g., "4.6", "4.5", "4"
  name: string;         // Display name
  description: string;  // Short description
  contextWindow: number;
  maxOutput: number;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  cacheWritePricePerMTok: number;
  cacheReadPricePerMTok: number;
  releaseDate: string;  // ISO date
  isLatest?: boolean;   // Marks the latest in the family
  isDefault?: boolean;  // Default model for new agents
}

export const MODELS: ModelDefinition[] = [
  // Opus family
  {
    id: "claude-opus-4-6",
    alias: "opus",
    family: "opus",
    version: "4.6",
    name: "Claude Opus 4.6",
    description: "Most powerful. 1M context, agent teams, breakthrough reasoning.",
    contextWindow: 1_000_000,
    maxOutput: 32_000,
    inputPricePerMTok: 5,
    outputPricePerMTok: 25,
    cacheWritePricePerMTok: 6.25,
    cacheReadPricePerMTok: 0.50,
    releaseDate: "2026-02-05",
    isLatest: true,
  },
  {
    id: "claude-opus-4-5-20251101",
    alias: "opus-4.5",
    family: "opus",
    version: "4.5",
    name: "Claude Opus 4.5",
    description: "Previous flagship. Extended thinking, strong coding.",
    contextWindow: 200_000,
    maxOutput: 16_000,
    inputPricePerMTok: 5,
    outputPricePerMTok: 25,
    cacheWritePricePerMTok: 6.25,
    cacheReadPricePerMTok: 0.50,
    releaseDate: "2025-11-01",
  },

  // Sonnet family
  {
    id: "claude-sonnet-4-5-20250929",
    alias: "sonnet",
    family: "sonnet",
    version: "4.5",
    name: "Claude Sonnet 4.5",
    description: "Best balance of speed, cost, and capability.",
    contextWindow: 200_000,
    maxOutput: 16_000,
    inputPricePerMTok: 3,
    outputPricePerMTok: 15,
    cacheWritePricePerMTok: 3.75,
    cacheReadPricePerMTok: 0.30,
    releaseDate: "2025-09-29",
    isLatest: true,
    isDefault: true,
  },
  {
    id: "claude-sonnet-4-20250514",
    alias: "sonnet-4",
    family: "sonnet",
    version: "4",
    name: "Claude Sonnet 4",
    description: "Balanced performance for most tasks.",
    contextWindow: 200_000,
    maxOutput: 16_000,
    inputPricePerMTok: 3,
    outputPricePerMTok: 15,
    cacheWritePricePerMTok: 3.75,
    cacheReadPricePerMTok: 0.30,
    releaseDate: "2025-05-14",
  },

  // Haiku family
  {
    id: "claude-haiku-4-5-20251001",
    alias: "haiku",
    family: "haiku",
    version: "4.5",
    name: "Claude Haiku 4.5",
    description: "Fastest and most affordable. Great for simple tasks.",
    contextWindow: 200_000,
    maxOutput: 8_000,
    inputPricePerMTok: 1,
    outputPricePerMTok: 5,
    cacheWritePricePerMTok: 1.25,
    cacheReadPricePerMTok: 0.10,
    releaseDate: "2025-10-01",
    isLatest: true,
  },
];

// Quick lookup helpers
export const MODEL_BY_ID = new Map(MODELS.map((m) => [m.id, m]));
export const MODEL_BY_ALIAS = new Map(MODELS.map((m) => [m.alias, m]));

export function getModelById(id: string): ModelDefinition | undefined {
  return MODEL_BY_ID.get(id);
}

export function getModelByAlias(alias: string): ModelDefinition | undefined {
  return MODEL_BY_ALIAS.get(alias);
}

export function resolveModel(idOrAlias: string): ModelDefinition | undefined {
  return MODEL_BY_ID.get(idOrAlias) ?? MODEL_BY_ALIAS.get(idOrAlias);
}

export function getDefaultModel(): ModelDefinition {
  return MODELS.find((m) => m.isDefault) ?? MODELS[0];
}

export function getLatestModels(): ModelDefinition[] {
  return MODELS.filter((m) => m.isLatest);
}

export function getModelsByFamily(family: ModelDefinition["family"]): ModelDefinition[] {
  return MODELS.filter((m) => m.family === family);
}

export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${tokens / 1_000_000}M`;
  if (tokens >= 1_000) return `${tokens / 1_000}K`;
  return String(tokens);
}

export function formatPrice(pricePerMTok: number): string {
  return `$${pricePerMTok.toFixed(2)}/MTok`;
}
