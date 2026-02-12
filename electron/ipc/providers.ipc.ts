/**
 * Provider IPC Handlers
 * Handles provider listing, model retrieval, and Copilot auth
 */

import { ipcMain } from "electron";
import { providerRegistry } from "../providers/provider-registry";
import { copilotAuth } from "../providers/copilot-auth";
import { logger } from "../utils/logger";
import type { ProviderType } from "../../src/types/ipc";

export function registerProviderHandlers(): void {
  // List all providers with availability status
  ipcMain.handle("provider:list", async () => {
    try {
      return await providerRegistry.listProviders();
    } catch (err) {
      logger.error("providers.ipc", "Failed to list providers", err);
      throw err;
    }
  });

  // Get models for a specific provider
  ipcMain.handle("provider:getModels", async (_event, provider: ProviderType) => {
    try {
      return await providerRegistry.getModels(provider);
    } catch (err) {
      logger.error("providers.ipc", `Failed to get models for ${provider}`, err);
      throw err;
    }
  });

  // Start Copilot OAuth device flow
  ipcMain.handle("copilot:startAuth", async () => {
    try {
      const deviceCode = await copilotAuth.initiateDeviceFlow();
      return {
        userCode: deviceCode.user_code,
        verificationUri: deviceCode.verification_uri,
        deviceCode: deviceCode.device_code,
        expiresIn: deviceCode.expires_in,
        interval: deviceCode.interval,
      };
    } catch (err) {
      logger.error("providers.ipc", "Failed to start Copilot auth", err);
      throw err;
    }
  });

  // Poll for Copilot token after user authorizes
  ipcMain.handle(
    "copilot:pollAuth",
    async (_event, deviceCode: string, interval: number, expiresIn: number) => {
      try {
        const accessToken = await copilotAuth.pollForToken(deviceCode, interval, expiresIn);

        // Get user info
        const user = await copilotAuth.getGitHubUser(accessToken);

        // Save tokens
        copilotAuth.saveTokens(accessToken, user.login);

        return {
          success: true,
          username: user.login,
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error("providers.ipc", `Copilot auth polling failed: ${errorMessage}`);
        return {
          success: false,
          error: errorMessage,
        };
      }
    }
  );

  // Check Copilot authentication status
  ipcMain.handle("copilot:checkAuth", async () => {
    try {
      const authenticated = copilotAuth.isAuthenticated();
      const username = copilotAuth.getStoredUsername();
      return {
        authenticated,
        username: username ?? undefined,
      };
    } catch (err) {
      logger.error("providers.ipc", "Failed to check Copilot auth", err);
      return {
        authenticated: false,
      };
    }
  });

  // Logout from Copilot
  ipcMain.handle("copilot:logout", async () => {
    try {
      copilotAuth.clearTokens();
    } catch (err) {
      logger.error("providers.ipc", "Failed to logout from Copilot", err);
      throw err;
    }
  });

  logger.info("providers.ipc", "Provider handlers registered");
}
