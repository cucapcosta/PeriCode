/**
 * Provider Registry
 * Central registry for managing provider adapters
 */

import type { ProviderAdapter, ProviderType, ProviderInfo, ModelInfo } from "./types";
import { claudeAdapter } from "./claude-adapter";
import { copilotAdapter } from "./copilot-adapter";
import { logger } from "../utils/logger";

// ── Registry State ────────────────────────────────────────

const adapters: Map<ProviderType, ProviderAdapter> = new Map();

// Register built-in adapters
adapters.set("claude", claudeAdapter);
adapters.set("copilot", copilotAdapter);

// ── Registry API ──────────────────────────────────────────

export const providerRegistry = {
  /**
   * Register a provider adapter
   */
  register(adapter: ProviderAdapter): void {
    adapters.set(adapter.name, adapter);
    logger.info("provider-registry", `Registered provider: ${adapter.name}`);
  },

  /**
   * Unregister a provider adapter
   */
  unregister(name: ProviderType): void {
    adapters.delete(name);
    logger.info("provider-registry", `Unregistered provider: ${name}`);
  },

  /**
   * Get a provider adapter by name
   */
  getAdapter(name: ProviderType): ProviderAdapter | undefined {
    return adapters.get(name);
  },

  /**
   * Get a provider adapter, throwing if not found
   */
  getAdapterOrThrow(name: ProviderType): ProviderAdapter {
    const adapter = adapters.get(name);
    if (!adapter) {
      throw new Error(`Provider not found: ${name}`);
    }
    return adapter;
  },

  /**
   * List all registered providers with availability status
   */
  async listProviders(): Promise<ProviderInfo[]> {
    const providers: ProviderInfo[] = [];

    for (const adapter of adapters.values()) {
      try {
        const available = await adapter.isAvailable();
        providers.push({
          id: adapter.name,
          name: adapter.displayName,
          available,
        });
      } catch (err) {
        logger.warn("provider-registry", `Error checking availability for ${adapter.name}`, err);
        providers.push({
          id: adapter.name,
          name: adapter.displayName,
          available: false,
        });
      }
    }

    return providers;
  },

  /**
   * Get models for a specific provider
   */
  async getModels(providerName: ProviderType): Promise<ModelInfo[]> {
    const adapter = adapters.get(providerName);
    if (!adapter) {
      throw new Error(`Provider not found: ${providerName}`);
    }
    return adapter.getModels();
  },

  /**
   * Check if a provider is registered
   */
  hasProvider(name: ProviderType): boolean {
    return adapters.has(name);
  },

  /**
   * Get all registered provider names
   */
  getProviderNames(): ProviderType[] {
    return Array.from(adapters.keys());
  },
};
