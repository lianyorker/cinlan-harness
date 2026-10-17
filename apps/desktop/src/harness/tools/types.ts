/** Tool system types */

/** Tool parameter schema */
export interface ToolParameter {
  readonly name: string
  readonly type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  readonly description: string
  readonly required: boolean
  readonly default?: unknown
}

/** Tool definition */
export interface ToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: ReadonlyArray<ToolParameter>
}

/** Tool execution result */
export interface ToolResult {
  readonly success: boolean
  readonly output?: unknown
  readonly error?: string
}

/** Tool interface */
export interface Tool {
  readonly definition: ToolDefinition
  execute(args: Record<string, unknown>): Promise<ToolResult>
}

/** Tool registry interface */
export interface ToolRegistry {
  register(tool: Tool): void
  unregister(name: string): void
  get(name: string): Tool | undefined
  list(): ReadonlyArray<ToolDefinition>
  execute(name: string, args: Record<string, unknown>): Promise<ToolResult>
}
