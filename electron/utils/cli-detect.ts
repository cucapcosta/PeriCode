import { execFile } from "child_process";
import { logger } from "./logger";

export interface CliDetectResult {
  available: boolean;
  version: string | null;
  path: string | null;
}

// Cache to avoid repeated spawns
let cachedResult: CliDetectResult | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 30_000;

export async function detectCli(
  customPath?: string
): Promise<CliDetectResult> {
  const now = Date.now();
  if (cachedResult && now - cacheTime < CACHE_TTL_MS) {
    return cachedResult;
  }

  const claudeBin = customPath || "claude";

  try {
    const version = await new Promise<string>((resolve, reject) => {
      execFile(
        claudeBin,
        ["--version"],
        { timeout: 5000 },
        (err, stdout, stderr) => {
          if (err) return reject(err);
          resolve((stdout || stderr).trim());
        }
      );
    });

    cachedResult = {
      available: true,
      version: version || null,
      path: claudeBin,
    };
  } catch (err) {
    logger.warn(
      "cli-detect",
      `Claude CLI not found at "${claudeBin}": ${err instanceof Error ? err.message : String(err)}`
    );
    cachedResult = { available: false, version: null, path: null };
  }

  cacheTime = now;
  return cachedResult;
}

export function clearCliCache(): void {
  cachedResult = null;
  cacheTime = 0;
}
