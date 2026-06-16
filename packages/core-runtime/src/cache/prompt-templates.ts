/**
 * Prompt Templates — Reusable Prompt Building Blocks
 *
 * Control Corridor:
 * - Owns: Template storage, variable substitution, versioning
 * - Must NOT own: LLM provider instantiation
 *
 * Provides a library of reusable prompt templates with variable substitution
 * for consistent and maintainable prompt construction.
 */

import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Template Types
// ---------------------------------------------------------------------------

export interface PromptTemplate {
  id: string;
  name: string;
  category: string;
  template: string;
  variables: TemplateVariable[];
  version: number;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateVariable {
  name: string;
  required: boolean;
  default?: string;
  description: string;
}

export interface TemplateRenderOptions {
  strict?: boolean;  // Throw if required variables are missing
}

// ---------------------------------------------------------------------------
// Prompt Template Engine
// ---------------------------------------------------------------------------

export class PromptTemplateEngine extends EventEmitter {
  private templates: Map<string, PromptTemplate> = new Map();
  private categoryIndex: Map<string, Set<string>> = new Map();

  constructor() {
    super();
    this.registerBuiltInTemplates();
  }

  // ---------------------------------------------------------------------------
  // Template Management
  // ---------------------------------------------------------------------------

  /**
   * Register a new template.
   */
  register(template: Omit<PromptTemplate, "version" | "usageCount" | "createdAt" | "updatedAt">): PromptTemplate {
    const now = new Date().toISOString();
    const fullTemplate: PromptTemplate = {
      ...template,
      version: 1,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.templates.set(fullTemplate.id, fullTemplate);
    this.addToCategoryIndex(fullTemplate.category, fullTemplate.id);

    this.emit("registered", { template: fullTemplate });
    return fullTemplate;
  }

  /**
   * Update an existing template.
   */
  update(id: string, updates: Partial<Pick<PromptTemplate, "template" | "variables" | "category" | "name">>): PromptTemplate | null {
    const template = this.templates.get(id);
    if (!template) return null;

    // Remove from old category index
    this.removeFromCategoryIndex(template.category, id);

    // Apply updates
    if (updates.template !== undefined) template.template = updates.template;
    if (updates.variables !== undefined) template.variables = updates.variables;
    if (updates.category !== undefined) template.category = updates.category;
    if (updates.name !== undefined) template.name = updates.name;

    template.version++;
    template.updatedAt = new Date().toISOString();

    // Add to new category index
    this.addToCategoryIndex(template.category, id);

    this.emit("updated", { template });
    return template;
  }

  /**
   * Delete a template.
   */
  delete(id: string): boolean {
    const template = this.templates.get(id);
    if (!template) return false;

    this.removeFromCategoryIndex(template.category, id);
    this.templates.delete(id);

    this.emit("deleted", { id });
    return true;
  }

  /**
   * Get a template by ID.
   */
  get(id: string): PromptTemplate | null {
    return this.templates.get(id) ?? null;
  }

  /**
   * List all templates.
   */
  list(category?: string): PromptTemplate[] {
    if (category) {
      const ids = this.categoryIndex.get(category) ?? new Set();
      return Array.from(ids)
        .map(id => this.templates.get(id))
        .filter((t): t is PromptTemplate => t !== undefined);
    }

    return Array.from(this.templates.values());
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /**
   * Render a template with variables.
   */
  render(
    id: string,
    variables: Record<string, string>,
    options: TemplateRenderOptions = {},
  ): string {
    const template = this.templates.get(id);
    if (!template) {
      throw new Error(`Template not found: ${id}`);
    }

    // Check required variables
    if (options.strict !== false) {
      for (const v of template.variables) {
        if (v.required && !(v.name in variables) && v.default === undefined) {
          throw new Error(`Missing required variable: ${v.name}`);
        }
      }
    }

    // Build variable map with defaults
    const vars: Record<string, string> = {};
    for (const v of template.variables) {
      if (v.name in variables) {
        vars[v.name] = variables[v.name]!;
      } else if (v.default !== undefined) {
        vars[v.name] = v.default;
      }
    }

    // Substitute variables
    let rendered = template.template;
    for (const [name, value] of Object.entries(vars)) {
      rendered = rendered.replace(new RegExp(`\\{\\{${name}\\}\\}`, "g"), value);
    }

    // Increment usage count
    template.usageCount++;

    this.emit("rendered", { id, variables: Object.keys(variables) });
    return rendered;
  }

  /**
   * Render a template by name.
   */
  renderByName(
    name: string,
    variables: Record<string, string>,
    options?: TemplateRenderOptions,
  ): string {
    const template = this.findByName(name);
    if (!template) {
      throw new Error(`Template not found: ${name}`);
    }
    return this.render(template.id, variables, options);
  }

  /**
   * Find a template by name.
   */
  findByName(name: string): PromptTemplate | undefined {
    return Array.from(this.templates.values()).find(t => t.name === name);
  }

  // ---------------------------------------------------------------------------
  // Built-in Templates
  // ---------------------------------------------------------------------------

  private registerBuiltInTemplates(): void {
    // System prompt template
    this.register({
      id: "builtin_system",
      name: "System Prompt",
      category: "system",
      template: `You are {{agentName}}, an AI assistant that helps with {{taskType}}.

Your capabilities include:
{{capabilities}}

Always be helpful, accurate, and concise.`,
      variables: [
        { name: "agentName", required: true, description: "Name of the agent" },
        { name: "taskType", required: true, description: "Type of tasks the agent handles" },
        { name: "capabilities", required: true, description: "List of capabilities" },
      ],
    });

    // Tool result template
    this.register({
      id: "builtin_tool_result",
      name: "Tool Result",
      category: "tool",
      template: `Tool call: {{toolName}}
Input: {{input}}
Result: {{result}}`,
      variables: [
        { name: "toolName", required: true, description: "Name of the tool" },
        { name: "input", required: true, description: "Tool input" },
        { name: "result", required: true, description: "Tool result" },
      ],
    });

    // Reflection template
    this.register({
      id: "builtin_reflection",
      name: "Reflection",
      category: "reflection",
      template: `Analyze the following and provide a reflection:

{{context}}

Provide:
1. What went well
2. What could be improved
3. Suggestions for next steps`,
      variables: [
        { name: "context", required: true, description: "Context to reflect on" },
      ],
    });

    // Summary template
    this.register({
      id: "builtin_summary",
      name: "Summary",
      category: "summarization",
      template: `Summarize the following content concisely:

{{content}}

Key points:`,
      variables: [
        { name: "content", required: true, description: "Content to summarize" },
      ],
    });

    // Memory injection template
    this.register({
      id: "builtin_memory_injection",
      name: "Memory Injection",
      category: "memory",
      template: `[Relevant Context]
{{memories}}

Use this context to help answer the user's question.`,
      variables: [
        { name: "memories", required: true, description: "Relevant memories to inject" },
      ],
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private addToCategoryIndex(category: string, id: string): void {
    if (!this.categoryIndex.has(category)) {
      this.categoryIndex.set(category, new Set());
    }
    this.categoryIndex.get(category)!.add(id);
  }

  private removeFromCategoryIndex(category: string, id: string): void {
    this.categoryIndex.get(category)?.delete(id);
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  exportData(): PromptTemplate[] {
    return Array.from(this.templates.values());
  }

  importData(templates: PromptTemplate[]): void {
    for (const template of templates) {
      this.templates.set(template.id, template);
      this.addToCategoryIndex(template.category, template.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPromptTemplateEngine(): PromptTemplateEngine {
  return new PromptTemplateEngine();
}
