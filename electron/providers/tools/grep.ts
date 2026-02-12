/**
 * Grep Tool - Search content in files
 */

import * as fs from "fs";
import * as path from "path";

export interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  context?: number;
  output_mode?: "content" | "files_with_matches" | "count";
}

export interface GrepMatch {
  file: string;
  line: number;
  content: string;
  context?: string[];
}

export interface GrepOutput {
  matches: GrepMatch[];
  fileCount: number;
  matchCount: number;
}

const MAX_FILES = 1000;
const MAX_FILE_SIZE = 1024 * 1024; // 1MB

export function grepTool(input: GrepInput, cwd: string): GrepOutput {
  const basePath = input.path
    ? path.isAbsolute(input.path)
      ? input.path
      : path.resolve(cwd, input.path)
    : cwd;

  const pattern = new RegExp(input.pattern, "gi");
  const context = input.context ?? 0;
  const outputMode = input.output_mode ?? "files_with_matches";

  const matches: GrepMatch[] = [];
  const matchedFiles = new Set<string>();
  let totalMatches = 0;

  // Find files to search
  const files = findFiles(basePath, input.glob);

  for (const file of files.slice(0, MAX_FILES)) {
    try {
      const stats = fs.statSync(file);
      if (stats.size > MAX_FILE_SIZE) continue;

      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          totalMatches++;
          matchedFiles.add(file);

          if (outputMode === "content") {
            const contextLines: string[] = [];
            if (context > 0) {
              for (let j = Math.max(0, i - context); j < i; j++) {
                contextLines.push(`${j + 1}: ${lines[j]}`);
              }
              for (let j = i + 1; j <= Math.min(lines.length - 1, i + context); j++) {
                contextLines.push(`${j + 1}: ${lines[j]}`);
              }
            }

            matches.push({
              file,
              line: i + 1,
              content: lines[i],
              context: contextLines.length > 0 ? contextLines : undefined,
            });
          }

          // Reset regex lastIndex for next test
          pattern.lastIndex = 0;
        }
      }
    } catch {
      // Ignore unreadable files
    }
  }

  // For files_with_matches mode, just return file paths
  if (outputMode === "files_with_matches") {
    for (const file of matchedFiles) {
      matches.push({
        file,
        line: 0,
        content: "",
      });
    }
  }

  return {
    matches,
    fileCount: matchedFiles.size,
    matchCount: totalMatches,
  };
}

function findFiles(basePath: string, globPattern?: string): string[] {
  const files: string[] = [];

  function walk(dir: string, depth = 0): void {
    if (depth > 15) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        // Skip hidden and common ignored
        if (entry.name.startsWith(".") ||
            entry.name === "node_modules" ||
            entry.name === "__pycache__" ||
            entry.name === "dist" ||
            entry.name === "build") {
          continue;
        }

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          // Apply glob filter if specified
          if (globPattern) {
            const ext = path.extname(entry.name);
            const globExt = globPattern.replace("*", "");
            if (!entry.name.endsWith(globExt) && !globPattern.includes("*.*")) {
              continue;
            }
          }
          files.push(fullPath);
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  if (fs.statSync(basePath).isFile()) {
    return [basePath];
  }

  walk(basePath);
  return files;
}
