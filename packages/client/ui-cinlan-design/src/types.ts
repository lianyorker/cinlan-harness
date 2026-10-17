/** Cinlan Design types for host and client boundaries. */

export interface DesignStylePreset {
  readonly id: string
  readonly name: string
  readonly tones: readonly string[]
  readonly sectors: readonly string[]
  readonly idea: string
  readonly composition: string
  readonly typography: string
  readonly colour: string
}

export interface AntiSlopFinding {
  readonly level: 'FAIL' | 'WARN'
  readonly ruleId: string
  readonly message: string
  readonly line?: number
  readonly sample?: string
}

export interface AntiSlopReport {
  readonly score: number
  readonly fails: number
  readonly warns: number
  readonly findings: readonly AntiSlopFinding[]
}

export type PinCategory = 'typography' | 'spatial' | 'palette' | 'component' | 'copy' | 'general'

export interface VisualPin {
  readonly id: string
  readonly xPercent: number
  readonly yPercent: number
  readonly comment: string
  readonly category: PinCategory
  readonly target?: string | undefined
  readonly selector?: string | undefined
  readonly createdAt: number
}
