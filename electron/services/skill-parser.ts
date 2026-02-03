import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";

/**
 * Parsed skill definition from a SKILL.md file.
 */
export interface ParsedSkillDefinition {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  maxBudgetUsd?: number;
  instructions: string;
  rawContent: string;
}

/**
 * Parse a SKILL.md file content into a structured skill definition.
 *
 * Format:
 *   ---
 *   name: Skill Name
 *   description: >
 *     Multi-line description
 *   model: sonnet
 *   tools:
 *     - Read
 *     - Grep
 *   max_budget_usd: 0.50
 *   ---
 *
 *   ## Instructions
 *   ...body content...
 */
export function parseSkillMd(content: string): ParsedSkillDefinition {
  const trimmed = content.trim();

  // Check for frontmatter delimiters
  if (!trimmed.startsWith("---")) {
    throw new Error("SKILL.md must start with --- frontmatter delimiter");
  }

  const secondDelimiter = trimmed.indexOf("---", 3);
  if (secondDelimiter === -1) {
    throw new Error("SKILL.md missing closing --- frontmatter delimiter");
  }

  const frontmatter = trimmed.slice(3, secondDelimiter).trim();
  const body = trimmed.slice(secondDelimiter + 3).trim();

  // Parse YAML-like frontmatter (simple key-value parser)
  const parsed = parseSimpleYaml(frontmatter);

  const name = parsed.name;
  if (!name) {
    throw new Error("SKILL.md frontmatter must include 'name'");
  }

  const description = parsed.description ?? "";
  const model = parsed.model;
  const tools = parsed.tools as string[] | undefined;
  const maxBudgetUsd = parsed.max_budget_usd
    ? parseFloat(String(parsed.max_budget_usd))
    : undefined;

  return {
    name: String(name),
    description: String(description),
    model: model ? String(model) : undefined,
    tools: tools
      ? (Array.isArray(tools) ? tools.map(String) : [String(tools)])
      : undefined,
    maxBudgetUsd:
      maxBudgetUsd !== undefined && !isNaN(maxBudgetUsd)
        ? maxBudgetUsd
        : undefined,
    instructions: body,
    rawContent: content,
  };
}

/**
 * Simple YAML-like parser for frontmatter.
 * Handles: key: value, key: > multi-line, key: [list with - items]
 */
function parseSimpleYaml(
  yaml: string
): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};
  const lines = yaml.split("\n");
  let currentKey = "";
  let currentValue = "";
  let inMultiline = false;
  let inList = false;
  let listItems: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (inList) {
      if (trimmedLine.startsWith("- ")) {
        listItems.push(trimmedLine.slice(2).trim());
        continue;
      } else {
        // End of list
        result[currentKey] = listItems;
        inList = false;
        listItems = [];
      }
    }

    if (inMultiline) {
      if (
        trimmedLine === "" ||
        (!line.startsWith(" ") && !line.startsWith("\t") && trimmedLine.includes(":"))
      ) {
        // End of multiline
        result[currentKey] = currentValue.trim();
        inMultiline = false;
      } else {
        currentValue += " " + trimmedLine;
        continue;
      }
    }

    // Parse key: value
    const colonIndex = trimmedLine.indexOf(":");
    if (colonIndex > 0) {
      currentKey = trimmedLine.slice(0, colonIndex).trim();
      const value = trimmedLine.slice(colonIndex + 1).trim();

      if (value === ">" || value === "|") {
        // Multiline value
        inMultiline = true;
        currentValue = "";
      } else if (value === "") {
        // Could be start of a list
        inList = true;
        listItems = [];
      } else {
        result[currentKey] = value;
      }
    }
  }

  // Handle trailing values
  if (inMultiline && currentKey) {
    result[currentKey] = currentValue.trim();
  }
  if (inList && currentKey) {
    result[currentKey] = listItems;
  }

  return result;
}

/**
 * Load and parse a SKILL.md file from disk.
 */
export function loadSkillFile(filePath: string): ParsedSkillDefinition | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return parseSkillMd(content);
  } catch (err) {
    logger.warn("skill-parser", `Failed to parse ${filePath}`, err);
    return null;
  }
}

/**
 * Write a skill definition to a SKILL.md file.
 */
export function writeSkillFile(
  dirPath: string,
  definition: ParsedSkillDefinition
): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  let frontmatter = `---\nname: ${definition.name}\n`;
  frontmatter += `description: >\n  ${definition.description}\n`;
  if (definition.model) {
    frontmatter += `model: ${definition.model}\n`;
  }
  if (definition.tools && definition.tools.length > 0) {
    frontmatter += `tools:\n`;
    for (const tool of definition.tools) {
      frontmatter += `  - ${tool}\n`;
    }
  }
  if (definition.maxBudgetUsd !== undefined) {
    frontmatter += `max_budget_usd: ${definition.maxBudgetUsd}\n`;
  }
  frontmatter += `---\n\n`;

  const content = frontmatter + definition.instructions;
  const filePath = path.join(dirPath, "SKILL.md");
  fs.writeFileSync(filePath, content, "utf-8");
}

/**
 * Scan a directory for SKILL.md files (one level deep).
 * Returns array of { dirName, parsed } for each found skill.
 */
export function scanSkillsDirectory(
  basePath: string
): Array<{ dirName: string; path: string; parsed: ParsedSkillDefinition }> {
  const results: Array<{
    dirName: string;
    path: string;
    parsed: ParsedSkillDefinition;
  }> = [];

  if (!fs.existsSync(basePath)) {
    return results;
  }

  const entries = fs.readdirSync(basePath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillFile = path.join(basePath, entry.name, "SKILL.md");
    const parsed = loadSkillFile(skillFile);
    if (parsed) {
      results.push({
        dirName: entry.name,
        path: path.join(basePath, entry.name),
        parsed,
      });
    }
  }

  return results;
}
