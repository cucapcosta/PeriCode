/**
 * Read Tool - Read file contents
 */

import * as fs from "fs";
import * as path from "path";

export interface ReadInput {
  file_path: string;
  offset?: number;
  limit?: number;
}

export interface ReadOutput {
  content: string;
  lineCount: number;
}

export function readTool(input: ReadInput, cwd: string): ReadOutput {
  const filePath = path.isAbsolute(input.file_path)
    ? input.file_path
    : path.resolve(cwd, input.file_path);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const stats = fs.statSync(filePath);
  if (stats.isDirectory()) {
    throw new Error(`Path is a directory, not a file: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  const offset = input.offset ?? 0;
  const limit = input.limit ?? lines.length;

  const selectedLines = lines.slice(offset, offset + limit);

  // Format with line numbers (1-indexed)
  const numberedLines = selectedLines.map((line, i) => {
    const lineNum = offset + i + 1;
    return `${String(lineNum).padStart(6, " ")}\t${line}`;
  });

  return {
    content: numberedLines.join("\n"),
    lineCount: lines.length,
  };
}
