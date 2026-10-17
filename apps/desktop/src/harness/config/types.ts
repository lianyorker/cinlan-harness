/** Harness configuration types */

/** Three-level configuration structure: global -> user -> project */
export interface HarnessConfig {
  readonly llm: LLMConfig
  readonly features: FeaturesConfig
  readonly storage: StorageConfig
  readonly ui: UIConfig
}

/** LLM provider configuration */
export interface LLMConfig {
  readonly provider: 'anthropic' | 'openai' | 'deepseek'
  readonly apiKey: string
  readonly model: string
  readonly temperature: number
  readonly maxTokens: number
  readonly streamOutput: boolean
}

/** Feature flags and toggles */
export interface FeaturesConfig {
  readonly autoSave: boolean
  readonly streaming: boolean
  readonly tools: readonly string[]
  readonly experimental: readonly string[]
}

/** Storage backend configuration */
export interface StorageConfig {
  readonly type: 'local' | 'cloud'
  readonly path: string
  readonly cachePath: string
}

/** UI preferences */
export interface UIConfig {
  readonly theme: 'light' | 'dark' | 'auto'
  readonly fontSize: number
  readonly showLineNumbers: boolean
}

/** Configuration file locations */
export interface ConfigPaths {
  readonly global: string
  readonly user: string
  readonly project: string
}

/** Partial configuration for merging */
export type PartialHarnessConfig = {
  [K in keyof HarnessConfig]?: HarnessConfig[K] | Partial<HarnessConfig[K]>
}

/** Default configuration values */
export const DEFAULT_CONFIG: HarnessConfig = {
  llm: {
    provider: 'anthropic',
    apiKey: '',
    model: 'claude-sonnet-4',
    temperature: 0.7,
    maxTokens: 4096,
    streamOutput: true,
  },
  features: {
    autoSave: true,
    streaming: true,
    tools: ['read_file', 'write_file', 'execute_command'],
    experimental: [],
  },
  storage: {
    type: 'local',
    path: '.harness',
    cachePath: '.harness/cache',
  },
  ui: {
    theme: 'auto',
    fontSize: 14,
    showLineNumbers: true,
  },
}
