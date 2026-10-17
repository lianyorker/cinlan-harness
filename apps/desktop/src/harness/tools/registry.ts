/** Tool registry implementation */

import type { Tool, ToolDefinition, ToolRegistry, ToolResult } from './types.ts'

/** In-memory tool registry */
export class MemoryToolRegistry implements ToolRegistry {
  private tools = new Map<string, Tool>()

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool)
  }

  unregister(name: string): void {
    this.tools.delete(name)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  list(): ReadonlyArray<ToolDefinition> {
    return Array.from(this.tools.values()).map(tool => tool.definition)
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${name}`,
      }
    }

    try {
      return await tool.execute(args)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
