/**
 * GitHub Copilot OAuth Authentication
 * Implements Device Flow for GitHub OAuth
 */

import { logger } from "../utils/logger";
import { storage } from "../services/storage";

// ── Constants ─────────────────────────────────────────────

// GitHub Copilot client ID (public, from VS Code Copilot extension)
const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";

const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";

// ── Types ─────────────────────────────────────────────────

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  error?: string;
  error_description?: string;
}

export interface CopilotToken {
  token: string;
  expires_at: number;
}

export interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
}

// ── Helper Functions ──────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Device Flow Implementation ────────────────────────────

/**
 * Step 1: Request device code from GitHub
 */
export async function initiateDeviceFlow(): Promise<DeviceCodeResponse> {
  logger.info("copilot-auth", "Initiating device flow");

  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      scope: "read:user",
    }),
  });

  if (!response.ok) {
    throw new Error(`Device code request failed: ${response.status}`);
  }

  const data = (await response.json()) as DeviceCodeResponse;
  logger.info("copilot-auth", `Device code received, user code: ${data.user_code}`);

  return data;
}

/**
 * Step 2: Poll for token after user authorizes
 */
export async function pollForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number
): Promise<string> {
  const startTime = Date.now();
  const expiryTime = startTime + expiresIn * 1000;

  logger.info("copilot-auth", "Polling for token...");

  while (Date.now() < expiryTime) {
    await sleep(interval * 1000);

    const response = await fetch(GITHUB_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data = (await response.json()) as TokenResponse;

    if (data.access_token) {
      logger.info("copilot-auth", "Token received successfully");
      return data.access_token;
    }

    if (data.error === "authorization_pending") {
      // User hasn't authorized yet, keep polling
      continue;
    }

    if (data.error === "slow_down") {
      // Increase polling interval
      interval += 5;
      continue;
    }

    if (data.error === "expired_token") {
      throw new Error("Device code expired. Please try again.");
    }

    if (data.error === "access_denied") {
      throw new Error("Authorization was denied by user.");
    }

    if (data.error) {
      throw new Error(data.error_description || data.error);
    }
  }

  throw new Error("Polling timed out. Please try again.");
}

/**
 * Get GitHub user info from access token
 */
export async function getGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get user info: ${response.status}`);
  }

  return (await response.json()) as GitHubUser;
}

/**
 * Get Copilot API token from GitHub access token
 */
export async function getCopilotToken(accessToken: string): Promise<CopilotToken> {
  const response = await fetch(COPILOT_TOKEN_URL, {
    headers: {
      Authorization: `token ${accessToken}`,
      Accept: "application/json",
      "Editor-Version": "vscode/1.85.0",
      "Editor-Plugin-Version": "copilot/1.0.0",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("copilot-auth", `Copilot token request failed: ${response.status} - ${text}`);
    throw new Error(`Failed to get Copilot token: ${response.status}`);
  }

  return (await response.json()) as CopilotToken;
}

// ── Token Storage ─────────────────────────────────────────

/**
 * Save tokens to storage
 */
export function saveTokens(
  accessToken: string,
  username: string,
  expiresAt?: number
): void {
  const settings = storage.getAppSettings();

  // Note: In production, tokens should be encrypted
  // For now, we store them in settings (which uses SQLite)
  const updatedSettings: Partial<typeof settings> = {
    providers: {
      defaultProvider: settings.providers?.defaultProvider ?? "claude",
      claude: settings.providers?.claude ?? { enabled: true, defaultModel: "sonnet" },
      copilot: {
        enabled: true,
        authenticated: true,
        accessToken,
        tokenExpiry: expiresAt,
        username,
        defaultModel: settings.providers?.copilot?.defaultModel ?? "gpt-4.1",
      },
    },
  };

  storage.updateAppSettings(updatedSettings);
  logger.info("copilot-auth", `Tokens saved for user: ${username}`);
}

/**
 * Get stored access token
 */
export function getStoredToken(): string | null {
  const settings = storage.getAppSettings();
  return settings.providers?.copilot?.accessToken ?? null;
}

/**
 * Check if token is expired
 */
export function isTokenExpired(): boolean {
  const settings = storage.getAppSettings();
  const expiry = settings.providers?.copilot?.tokenExpiry;

  if (!expiry) return false;

  // Add 5 minute buffer
  return Date.now() > expiry - 5 * 60 * 1000;
}

/**
 * Get stored username
 */
export function getStoredUsername(): string | null {
  const settings = storage.getAppSettings();
  return settings.providers?.copilot?.username ?? null;
}

/**
 * Check authentication status
 */
export function isAuthenticated(): boolean {
  const settings = storage.getAppSettings();
  return settings.providers?.copilot?.authenticated === true &&
         !!settings.providers?.copilot?.accessToken;
}

/**
 * Clear all stored tokens (logout)
 */
export function clearTokens(): void {
  const settings = storage.getAppSettings();

  const updatedSettings: Partial<typeof settings> = {
    providers: {
      defaultProvider: settings.providers?.defaultProvider ?? "claude",
      claude: settings.providers?.claude ?? { enabled: true, defaultModel: "sonnet" },
      copilot: {
        enabled: false,
        authenticated: false,
        accessToken: undefined,
        refreshToken: undefined,
        tokenExpiry: undefined,
        username: undefined,
        defaultModel: settings.providers?.copilot?.defaultModel ?? "gpt-4.1",
      },
    },
  };

  storage.updateAppSettings(updatedSettings);
  logger.info("copilot-auth", "Tokens cleared");
}

// ── Public API ────────────────────────────────────────────

export const copilotAuth = {
  initiateDeviceFlow,
  pollForToken,
  getGitHubUser,
  getCopilotToken,
  saveTokens,
  getStoredToken,
  getStoredUsername,
  isAuthenticated,
  isTokenExpired,
  clearTokens,
};
