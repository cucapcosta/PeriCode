/**
 * Edit Tool - Search and replace in files
 */

import * as fs from "fs";
import * as path from "path";

export interface EditInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface EditOutput {
  success: boolean;
  replacements: number;
}

export function editTool(input: EditInput, cwd: string): EditOutput {
  const filePath = path.isAbsolute(input.file_path)
    ? input.file_path
    : path.resolve(cwd, input.file_path);

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, "utf-8");

  // Count occurrences
  const regex = input.replace_all
    ? new RegExp(escapeRegExp(input.old_string), "g")
    : new RegExp(escapeRegExp(input.old_string));

  const matches = content.match(new RegExp(escapeRegExp(input.old_string), "g"));
  const matchCount = matches?.length ?? 0;

  if (matchCount === 0) {
    throw new Error(`String not found in file: "${input.old_string.slice(0, 50)}..."`);
  }

  if (!input.replace_all && matchCount > 1) {
    throw new Error(
      `String "${input.old_string.slice(0, 50)}..." found ${matchCount} times. ` +
      `Use replace_all=true to replace all, or provide more context to make it unique.`
    );
  }

  const newContent = content.replace(regex, input.new_string);
  fs.writeFileSync(filePath, newContent, "utf-8");

  return {
    success: true,
    replacements: input.replace_all ? matchCount : 1,
  };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
