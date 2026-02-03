import fs from "fs";
import path from "path";
import { logger } from "../utils/logger";
import type { AutomationConfig, Automation } from "../../src/types/ipc";

const TEMPLATES_PATH = path.join(__dirname, "../../automation-templates");

export interface AutomationTemplate {
  name: string;
  description: string;
  prompt: string;
  triggerType: Automation["triggerType"];
  schedule: string | null;
  triggerConfig: Record<string, unknown>;
  skillIds: string[];
}

/**
 * Load all built-in automation templates.
 */
export function loadAutomationTemplates(): AutomationTemplate[] {
  const templates: AutomationTemplate[] = [];

  if (!fs.existsSync(TEMPLATES_PATH)) {
    logger.warn("automation-templates", `Templates directory not found: ${TEMPLATES_PATH}`);
    return templates;
  }

  const files = fs.readdirSync(TEMPLATES_PATH).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(TEMPLATES_PATH, file), "utf-8");
      const template = JSON.parse(content) as AutomationTemplate;

      if (!template.name || !template.prompt || !template.triggerType) {
        logger.warn("automation-templates", `Invalid template ${file}: missing required fields`);
        continue;
      }

      templates.push(template);
    } catch (err) {
      logger.warn("automation-templates", `Failed to parse template ${file}`, err);
    }
  }

  logger.info("automation-templates", `Loaded ${templates.length} automation templates`);
  return templates;
}

/**
 * Convert a template to an AutomationConfig for a given project.
 */
export function templateToConfig(
  template: AutomationTemplate,
  projectId: string
): AutomationConfig {
  return {
    projectId,
    name: template.name,
    prompt: template.prompt,
    triggerType: template.triggerType,
    schedule: template.schedule ?? undefined,
    triggerConfig: template.triggerConfig,
    skillIds: template.skillIds,
    budgetLimitUsd: (template.triggerConfig.budgetLimitUsd as number) ?? 1.0,
    sandboxPolicy: (template.triggerConfig.sandboxPolicy as "read-only" | "workspace-write" | "full") ?? "read-only",
  };
}
