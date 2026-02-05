/**
 * Model pricing table (USD per million tokens).
 * Source: Anthropic API pricing page.
 */

interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheWritePerMTok: number;   // 5-minute TTL (default)
  cacheReadPerMTok: number;    // Cache hits & refreshes
}

const PRICING_TABLE: Record<string, ModelPricing> = {
  // Opus family
  "opus-4.5":  { inputPerMTok: 5,     outputPerMTok: 25,    cacheWritePerMTok: 6.25,   cacheReadPerMTok: 0.50  },
  "opus-4.1":  { inputPerMTok: 15,    outputPerMTok: 75,    cacheWritePerMTok: 18.75,  cacheReadPerMTok: 1.50  },
  "opus-4":    { inputPerMTok: 15,    outputPerMTok: 75,    cacheWritePerMTok: 18.75,  cacheReadPerMTok: 1.50  },
  "opus-3":    { inputPerMTok: 15,    outputPerMTok: 75,    cacheWritePerMTok: 18.75,  cacheReadPerMTok: 1.50  },

  // Sonnet family
  "sonnet-4.5": { inputPerMTok: 3,    outputPerMTok: 15,    cacheWritePerMTok: 3.75,   cacheReadPerMTok: 0.30  },
  "sonnet-4":   { inputPerMTok: 3,    outputPerMTok: 15,    cacheWritePerMTok: 3.75,   cacheReadPerMTok: 0.30  },
  "sonnet-3.7": { inputPerMTok: 3,    outputPerMTok: 15,    cacheWritePerMTok: 3.75,   cacheReadPerMTok: 0.30  },

  // Haiku family
  "haiku-4.5":  { inputPerMTok: 1,    outputPerMTok: 5,     cacheWritePerMTok: 1.25,   cacheReadPerMTok: 0.10  },
  "haiku-3.5":  { inputPerMTok: 0.80, outputPerMTok: 4,     cacheWritePerMTok: 1.00,   cacheReadPerMTok: 0.08  },
  "haiku-3":    { inputPerMTok: 0.25, outputPerMTok: 1.25,  cacheWritePerMTok: 0.30,   cacheReadPerMTok: 0.025 },
};

// Default fallback: Sonnet 4 pricing
const DEFAULT_PRICING: ModelPricing = PRICING_TABLE["sonnet-4"];

/**
 * Extract a short model key from a full model ID.
 * e.g. "claude-opus-4-5-20251101" -> "opus-4.5"
 *      "claude-sonnet-4-20250514" -> "sonnet-4"
 */
function modelIdToKey(modelId: string): string {
  const m = modelId.match(/claude-(\w+)-([\d]+(?:-[\d]+)?)-\d{8}/);
  if (m) {
    const family = m[1];
    const version = m[2].replace("-", ".");
    return `${family}-${version}`;
  }
  // Fallback: strip "claude-" prefix
  return modelId.replace(/^claude-/, "");
}

function getPricing(modelId: string): ModelPricing {
  const key = modelIdToKey(modelId);
  return PRICING_TABLE[key] ?? DEFAULT_PRICING;
}

/**
 * Estimate cost in USD from token counts for a given model.
 */
export function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationInputTokens: number,
  cacheReadInputTokens: number
): number {
  const p = getPricing(modelId);
  const perToken = 1_000_000;

  return (
    (inputTokens / perToken) * p.inputPerMTok +
    (outputTokens / perToken) * p.outputPerMTok +
    (cacheCreationInputTokens / perToken) * p.cacheWritePerMTok +
    (cacheReadInputTokens / perToken) * p.cacheReadPerMTok
  );
}

/**
 * Get the pricing info for a model (for display purposes).
 */
export function getModelPricing(modelId: string): ModelPricing & { modelKey: string } {
  const key = modelIdToKey(modelId);
  const pricing = PRICING_TABLE[key] ?? DEFAULT_PRICING;
  return { ...pricing, modelKey: key };
}

/**
 * List all known model pricings.
 */
export function getAllPricings(): Record<string, ModelPricing> {
  return { ...PRICING_TABLE };
}
