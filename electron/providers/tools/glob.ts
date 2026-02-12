/**
 * Glob Tool - Find files by pattern
 */

import * as fs from "fs";
import * as path from "path";

export interface GlobInput {
  pattern: string;
  path?: string;
}

export interface GlobOutput {
  files: string[];
  count: number;
}

/**
 * Simple glob implementation without external dependencies
 * Supports basic patterns: *, **, ?
 */
export function globTool(input: GlobInput, cwd: string): GlobOutput {
  const basePath = input.path
    ? path.isAbsolute(input.path)
      ? input.path
      : path.resolve(cwd, input.path)
    : cwd;

  const pattern = input.pattern;
  const files: string[] = [];

  // Convert glob pattern to regex
  const regexPattern = globToRegex(pattern);

  // Walk directory tree
  walkDir(basePath, basePath, regexPattern, files);

  // Sort by modification time (newest first)
  files.sort((a, b) => {
    try {
      const statA = fs.statSync(a);
      const statB = fs.statSync(b);
      return statB.mtimeMs - statA.mtimeMs;
    } catch {
      return 0;
    }
  });

  return {
    files,
    count: files.length,
  };
}

function globToRegex(pattern: string): RegExp {
  let regex = pattern
    // Escape special regex chars (except * and ?)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    // ** matches any path
    .replace(/\*\*/g, "{{DOUBLESTAR}}")
    // * matches anything except /
    .replace(/\*/g, "[^/\\\\]*")
    // ? matches single char
    .replace(/\?/g, ".")
    // Restore **
    .replace(/{{DOUBLESTAR}}/g, ".*");

  return new RegExp(`^${regex}$`);
}

function walkDir(
  dir: string,
  basePath: string,
  pattern: RegExp,
  results: string[],
  maxDepth = 20
): void {
  if (maxDepth <= 0) return;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files and common ignored directories
      if (entry.name.startsWith(".") ||
          entry.name === "node_modules" ||
          entry.name === "__pycache__") {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(basePath, fullPath).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        walkDir(fullPath, basePath, pattern, results, maxDepth - 1);
      } else if (entry.isFile()) {
        if (pattern.test(relativePath) || pattern.test(entry.name)) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Ignore permission errors
  }
}
