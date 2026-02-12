/**
 * Write Tool - Write content to a file
 */

import * as fs from "fs";
import * as path from "path";

export interface WriteInput {
  file_path: string;
  content: string;
}

export interface WriteOutput {
  success: boolean;
  bytesWritten: number;
}

export function writeTool(input: WriteInput, cwd: string): WriteOutput {
  const filePath = path.isAbsolute(input.file_path)
    ? input.file_path
    : path.resolve(cwd, input.file_path);

  // Ensure parent directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, input.content, "utf-8");

  return {
    success: true,
    bytesWritten: Buffer.byteLength(input.content, "utf-8"),
  };
}
