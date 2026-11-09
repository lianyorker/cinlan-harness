/**
 * Security REA service (`ctx.securityRea`): mounts the pinned `rea-agents`
 * package as an MCP stdio server inside the security-research composition,
 * publishing its reverse-engineering tools as `mcp__rea__*`. The runtime
 * Node that spawns REA is explicit configuration (`nodeExecutable`), never
 * `process.execPath`, because the product host runtime can sit below the
 * `rea-agents` engines floor while the bundled primary-runtime satisfies it.
 * An unsatisfied runtime degrades to an `unavailable` status instead of
 * failing product startup.
 *
 * @module @cinlan/security-rea
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { clhHomePath } from '@deepseek-ai/dsh-home-paths'
import { launchMcpClient, type ConnectionHandle } from '@deepseek-ai/dsh-mcp-client'
// Side-effect type imports: declaration-merge `ctx.tools` and `ctx.skills` onto Context.
import type {} from '@deepseek-ai/dsh-tools'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'
import {
  assertReaEnvironment, evaluateNodeEngines, parseNodeVersion,
  type NodeVersion, type ReaUnavailableReason,
} from './node-probe.ts'

export type { EnginesVerdict, NodeVersion, ReaUnavailableReason } from './node-probe.ts'
export { assertReaEnvironment, evaluateNodeEngines, parseNodeVersion } from './node-probe.ts'
export type {
  SecurityReaDoctor, SecurityReaState, SecurityReaStatus, SecurityReaToolProbe,
} from './types.ts'
import type {
  SecurityReaDoctor, SecurityReaStatus, SecurityReaToolProbe,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    securityRea: SecurityRea
  }
}

/** Plugin configuration; every deployment-varying choice lives here. */
export interface Config {
  /**
   * Absolute path of the Node executable used to spawn the REA server.
   * Required; the security-research bundle points it at the primary-runtime
   * Node. `process.execPath` is never a fallback.
   */
  nodeExecutable?: string
  /**
   * Absolute path of an alternative MCP server entry script, replacing the
   * resolved `rea-agents` CLI. Deployments that supply their own server own
   * its Node requirements, so the pinned package's engines range is not
   * checked for this launch.
   */
  reaScript?: string
  /** REA state directory; defaults to `<clh home>/security/rea/`. Must stay outside `.dsh`. */
  stateDir?: string
  /** Timeout per REA tool call in milliseconds; must be a positive safe integer. */
  toolCallTimeoutMs?: number
  /** Timeout for each doctor probe in milliseconds; must be a positive safe integer. */
  probeTimeoutMs?: number
  /**
   * Bound for the initial MCP handshake plus tool sync in milliseconds; must
   * be a positive safe integer. On timeout the service still activates and
   * reports an `unavailable` status — product startup never hangs on REA.
   */
  startupTimeoutMs?: number
  /** Command names probed by `doctor()` on PATH. */
  doctorTools?: readonly string[]
  /**
   * REA's `REA_MCP_OUTPUT_SCHEMA_PROFILE` for the spawned server. Defaults to
   * `"off"`: output schemas (≈3.2 MB over `tools/list`) never reach the model
   * and REA still validates results, so omitting them is pure savings. Set
   * `"full"` to advertise them again.
   */
  outputSchemaProfile?: 'full' | 'off'
  /**
   * Complete replacement for the MCP tool allowlist: only these raw REA tool
   * names are registered. Omission registers {@link REA_DEFAULT_TOOL_NAMES},
   * the measured static-analysis core (≈69 KB / ≈19k prompt tokens per
   * request vs ≈73k for the full 229-tool catalog). Dynamic lanes (adb,
   * Frida, debuggers, live browser/Electron) are intentionally absent.
   */
  toolAllowlist?: readonly string[]
  /**
   * Extra raw REA tool names admitted on top of {@link toolAllowlist} — the
   * opt-in lane for dynamic/device tools without replacing the default set.
   */
  additionalTools?: readonly string[]
}

/**
 * Default MCP tool allowlist: the static-analysis core measured against
 * `rea-agents@6.8.0` (2026-11-01). Session lifecycle, native inventory,
 * function-level analysis, call-graph/reference tracing, artifact and
 * mainstream format inspectors, evidence access, and analyst annotation.
 * Dynamic, device, and runtime-capture lanes stay opt-in through
 * `additionalTools` or a full `toolAllowlist`.
 */
export const REA_DEFAULT_TOOL_NAMES = [
  // Session lifecycle and binary overview.
  'open_binary', 'close_binary', 'binary_session', 'binary_overview', 'open_bundle_resources',
  // Native inventory.
  'list_procedures', 'search_procedures', 'list_strings', 'search_strings', 'list_names', 'list_segments',
  // Function-level analysis.
  'procedure_info', 'procedure_pseudo_code', 'procedure_assembly', 'procedure_callers', 'procedure_callees',
  'procedure_references', 'read_function_instructions', 'read_bytes', 'search_bytes', 'procedure_address',
  'resolve_containing_procedure',
  // Call graph and reference tracing.
  'analyze_function', 'xrefs', 'trace_feature', 'trace_call_path', 'get_call_graph', 'resolve_native_call_targets',
  // Native inspection.
  'inspect_native_instruction', 'inspect_native_api', 'inspect_binary_layout', 'inspect_native_load_image',
  'inspect_native_exports', 'inspect_native_dispatch_metadata', 'inspect_native_data_type',
  // Artifact and mainstream format inspectors.
  'inspect_artifact', 'extract_artifact', 'inspect_pe_imports', 'inspect_pe_resources', 'inspect_pe_certificates',
  'inspect_pe_load_config', 'inspect_macho', 'list_architectures', 'inspect_plist', 'inspect_elf_notes',
  'inspect_byte_entropy',
  // Android package lane (static).
  'inspect_android_package', 'inspect_apk_signature', 'decode_android_resources',
  // Evidence access.
  'get_evidence_bundle', 'export_evidence_bundle', 'inspect_analysis_view',
  // Analyst annotation.
  'set_comment', 'set_inline_comment', 'annotate_native_function', 'set_address_name', 'comment',
  'inline_comment', 'address_name', 'list_bookmarks', 'set_bookmark', 'unset_bookmark',
] as const


/**
 * Routing description of the bundled `reverse-engineer-anything` skill:
 * REA's own description plus plain-Chinese trigger phrases so requests like
 * “帮我看看这个 exe 是干嘛的” select this skill without naming REA or tools.
 */
export const REA_SKILL_DESCRIPTION = 'Reverse engineer native, managed, Electron/JavaScript, packaged, firmware, and browser targets with REA, and build agent environments (AgentEnv bundles) of web applications from a live instance or a capture. Use shipped-artifact or requested runtime evidence to explain features, compare versions, decompile code, or guide a reconstruction. Skip REA for ordinary source-repository architecture analysis. 中文口语触发：逆向分析、逆向工程、逆向这个程序、脱壳、破解、反编译、看看这个 exe/dll/so/elf/apk 是干嘛的、分析一下这个二进制/安装包/固件/程序、这个文件是什么格式、协议还原、这个软件怎么实现的。'

/** Commands probed by `doctor()` when `doctorTools` is not configured. */
const DEFAULT_DOCTOR_TOOLS = [
  'ghidra', 'jadx', 'java', 'frida', 'adb', 'gdb', 'rizin', 'r2', 'objdump', 'apktool',
] as const

/** Facts required to decide whether REA may launch. */
export interface ReaAssessment {
  /** Spawnable Node executable, or undefined when not configured. */
  readonly nodeExecutable?: string | undefined
  /** Version parsed from `<nodeExecutable> --version`, when the probe ran. */
  readonly nodeVersion?: NodeVersion | undefined
  /** Raw `node --version` text for status reporting. */
  readonly nodeVersionText?: string | undefined
  /** `engines.node` declared by the pinned `rea-agents` package. */
  readonly enginesRange?: string | undefined
  /** Version declared by the pinned `rea-agents` package. */
  readonly reaVersion?: string | undefined
  /** Whether the pinned `rea-agents` package resolved inside this package. */
  readonly reaPackageFound: boolean
}

/** Launch decision produced by {@link assessReaReadiness}. */
export type ReaReadiness =
  | { readonly kind: 'disabled'; readonly reason: 'not-configured' }
  | {
    readonly kind: 'unavailable'
    readonly reason: ReaUnavailableReason
    readonly detail: string
    readonly nodeVersion?: string | undefined
    readonly requiredEngines?: string | undefined
  }
  | { readonly kind: 'launch' }

/**
 * Decide whether the configured runtime may launch REA. Unsatisfied engines
 * are a status, not a thrown error, so product startup is never blocked.
 * @param assessment - Probed runtime facts.
 * @returns Launch decision carrying the failure classification when refused.
 */
export function assessReaReadiness(assessment: ReaAssessment): ReaReadiness {
  if (assessment.nodeExecutable === undefined || assessment.nodeExecutable.trim() === '') {
    return { kind: 'disabled', reason: 'not-configured' }
  }
  if (!assessment.reaPackageFound) {
    return { kind: 'unavailable', reason: 'rea-package-missing', detail: '未找到内置的逆向分析组件（rea-agents），请重新安装产品。' }
  }
  if (assessment.nodeVersion === undefined) {
    return {
      kind: 'unavailable', reason: 'node-probe-failed',
      detail: `逆向分析需要的运行时无法启动：${assessment.nodeExecutable}`,
    }
  }
  if (assessment.enginesRange !== undefined) {
    const verdict = evaluateNodeEngines(assessment.nodeVersion, assessment.enginesRange)
    if (verdict === 'unsatisfied') {
      return {
        kind: 'unavailable', reason: 'engines-unsatisfied',
        detail: `逆向分析需要更新运行时：当前 Node ${assessment.nodeVersionText ?? '未知'}，需要 ${assessment.enginesRange}。`,
        nodeVersion: assessment.nodeVersionText,
        requiredEngines: assessment.enginesRange,
      }
    }
    if (verdict === 'unknown') {
      return {
        kind: 'unavailable', reason: 'engines-unknown',
        detail: `无法确认逆向分析所需的运行时版本（${assessment.enginesRange}），暂不启动。`,
        nodeVersion: assessment.nodeVersionText,
        requiredEngines: assessment.enginesRange,
      }
    }
  }
  return { kind: 'launch' }
}

/** Location facts of the pinned `rea-agents` package resolved from this module. */
export interface ReaArtifact {
  readonly packageJsonPath: string
  readonly scriptPath: string
  readonly version?: string | undefined
  readonly enginesRange?: string | undefined
}

/** Read the pinned `rea-agents` artifact without executing any of its code. */
export function resolveReaArtifact(): ReaArtifact {
  const req = createRequire(import.meta.url)
  let packageJsonPath: string
  try {
    packageJsonPath = req.resolve('rea-agents/package.json')
  } catch {
    const entry = req.resolve('rea-agents')
    packageJsonPath = findPackageJson(dirname(entry))
  }
  let version: string | undefined
  let enginesRange: string | undefined
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { version?: unknown; engines?: { node?: unknown } }
    version = typeof parsed.version === 'string' ? parsed.version : undefined
    enginesRange = typeof parsed.engines?.node === 'string' ? parsed.engines.node : undefined
  } catch {
    // Package metadata unreadable; launch still attempted with engines unknown.
  }
  return { packageJsonPath, scriptPath: join(dirname(packageJsonPath), 'scripts', 'rea.mjs'), version, enginesRange }
}

/** Walk up from a resolved entry path to the owning package.json. */
function findPackageJson(from: string): string {
  let directory = from
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(directory, 'package.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  throw new Error('security-rea: cannot locate rea-agents package.json')
}

/** Probe `<executable> --version` with a hard timeout; never throws. */
export function probeNode(executable: string, timeoutMs: number): { version?: NodeVersion | undefined; text?: string | undefined } {
  if (!existsSync(executable)) return {}
  try {
    const result = spawnSync(executable, ['--version'], { timeout: timeoutMs, encoding: 'utf8', windowsHide: true })
    if (result.error !== undefined || result.status !== 0) return {}
    const text = (result.stdout ?? result.stderr ?? '').toString().trim()
    return { version: parseNodeVersion(text), text }
  } catch {
    return {}
  }
}

/**
 * REA capability service. Mounts the pinned `rea-agents` MCP server on
 * construction when the configured runtime satisfies its engines; every
 * refusal is recorded on {@link status} instead of thrown.
 */
export class SecurityRea extends Service {
  static inject = ['tools', 'skills']

  private readonly config: Config
  private readonly stateDir: string
  private refusal: Extract<ReaReadiness, { kind: 'disabled' | 'unavailable' }> | undefined
  private connection: ConnectionHandle | undefined
  private readonly artifact: ReaArtifact | undefined
  private scriptPath: string | undefined
  private startupTimedOut = false
  private readonly probedNode: { version?: NodeVersion | undefined; text?: string | undefined } | undefined

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'securityRea')
    this.config = config
    this.stateDir = config.stateDir ?? clhHomePath('security', 'rea')
    const nodeExecutable = config.nodeExecutable?.trim()
    this.probedNode = nodeExecutable === undefined ? undefined : probeNode(nodeExecutable, this.probeTimeout())
    let artifact: ReaArtifact | undefined
    try {
      artifact = resolveReaArtifact()
    } catch {
      artifact = undefined
    }
    this.artifact = artifact
    const reaScript = config.reaScript?.trim()
    this.scriptPath = reaScript === undefined ? artifact?.scriptPath : reaScript
    const readiness = assessReaReadiness({
      nodeExecutable,
      nodeVersion: this.probedNode?.version,
      nodeVersionText: this.probedNode?.text,
      // A configured script is not the pinned CLI: its provider, not the
      // bundled package's engines range, defines its runtime requirement.
      enginesRange: reaScript === undefined ? artifact?.enginesRange : undefined,
      reaVersion: artifact?.version,
      reaPackageFound: this.scriptPath !== undefined && existsSync(this.scriptPath),
    })
    if (readiness.kind !== 'launch') {
      this.refusal = readiness
      return
    }
    assertReaEnvironment({}, this.stateDir)
    mkdirSync(this.stateDir, { recursive: true })
    const handle = launchMcpClient(ctx, {
      transport: 'stdio',
      serverName: 'rea',
      command: nodeExecutable as string,
      args: [this.scriptPath as string, 'mcp'],
      env: {
        // Output schemas never reach the model; REA still validates results.
        REA_MCP_OUTPUT_SCHEMA_PROFILE: this.outputSchemaProfile(),
      },
      cwd: this.stateDir,
      toolCallTimeoutMs: this.toolCallTimeout(),
      toolFilter: this.toolFilter(),
      failOnStartupError: false,
    }, { owner: { kind: 'composition', label: 'security-rea' } })
    this.connection = handle
    this.registerBundledSkill()
  }

  /**
   * Cordis awaits the returned promise while the entry activates, so the first
   * model request cannot race the MCP handshake: `mcp__rea__*` registrations
   * land before the session's tool catalog is serialized. A failed attempt
   * resolves with `{ error }` and stays an `unavailable` status — product
   * startup is never blocked by the REA server. The wait is bounded by
   * `startupTimeoutMs`; a server that never answers degrades the status to
   * `unavailable` instead of stalling activation.
   */
  async [Service.init](): Promise<void> {
    const ready = this.connection?.ready
    if (ready === undefined) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), this.startupTimeout())
      timer.unref?.()
    })
    const outcome = await Promise.race([ready.then((): 'ready' => 'ready'), timedOut])
    clearTimeout(timer)
    if (outcome === 'timeout') {
      this.startupTimedOut = true
      this.ctx.logger?.warn('security-rea: MCP handshake exceeded startupTimeoutMs; reporting unavailable')
    }
  }

  /**
   * Register the `reverse-engineer-anything` skill shipped inside `rea-agents`
   * as a bundled runtime skill. The description carries Chinese conversational
   * trigger phrases so plain-language requests route here without tool names.
   */
  private registerBundledSkill(): void {
    const artifact = this.artifact
    if (artifact === undefined) return
    const skills = this.ctx.get('skills')
    if (skills === undefined) return
    const skillDir = join(dirname(artifact.packageJsonPath), 'skills', 'reverse-engineer-anything')
    const skillFile = join(skillDir, 'SKILL.md')
    if (!existsSync(skillFile)) {
      this.ctx.logger?.warn('security-rea: bundled reverse-engineer-anything SKILL.md is missing from rea-agents')
      return
    }
    const registration: SkillRegistration = {
      name: 'reverse-engineer-anything',
      description: REA_SKILL_DESCRIPTION,
      content: readFileSync(skillFile, 'utf8'),
      path: skillFile,
      source: 'bundled',
      resourceBase: { kind: 'directory', path: skillDir },
    }
    skills.register(registration)
  }

  /** Current service availability and failure classification. */
  status(): SecurityReaStatus {
    if (this.refusal !== undefined) {
      return {
        state: this.refusal.kind,
        reason: this.refusal.reason,
        detail: 'detail' in this.refusal ? this.refusal.detail : '未配置逆向分析运行时（nodeExecutable）。',
        reaVersion: this.artifact?.version,
      }
    }
    const snapshot = this.connection?.getSnapshot()
    if (this.startupTimedOut) {
      return {
        state: 'unavailable',
        reason: 'startup-timeout',
        detail: '逆向分析服务启动超时；重启会话可重试。',
        reaVersion: this.artifact?.version,
        nodeVersion: this.probedNode?.text,
      }
    }
    if (snapshot === undefined) return { state: 'connecting', reaVersion: this.artifact?.version }
    switch (snapshot.phase) {
      case 'ready':
        return {
          state: 'ready',
          reaVersion: this.artifact?.version,
          nodeVersion: this.probedNode?.text,
          toolCount: snapshot.tools.length,
        }
      case 'error':
        return {
          state: 'unavailable',
          reason: 'connection-failed',
          detail: '逆向分析服务连接失败；重启会话可重试。',
          reaVersion: this.artifact?.version,
          nodeVersion: this.probedNode?.text,
        }
      default:
        return { state: 'connecting', reaVersion: this.artifact?.version, nodeVersion: this.probedNode?.text }
    }
  }

  /**
   * Report runtime facts and host tool availability for the settings page.
   * @returns Doctor report; missing tools carry a plain-language hint.
   */
  async doctor(): Promise<SecurityReaDoctor> {
    const names = this.config.doctorTools ?? DEFAULT_DOCTOR_TOOLS
    const tools = names.map(name => this.probeTool(name))
    return { status: this.status(), stateDir: this.stateDir, tools }
  }

  private probeTool(name: string): SecurityReaToolProbe {
    try {
      const result = spawnSync(name, ['--version'], {
        timeout: this.probeTimeout(), encoding: 'utf8', windowsHide: true,
      })
      if (result.error !== undefined) {
        return { name, detected: false, hint: `未在 PATH 找到 ${name}，需要时请先安装并加入 PATH。` }
      }
      const first = `${result.stdout ?? ''}${result.stderr ?? ''}`.split(/\r?\n/u).find(line => line.trim().length > 0)
      return { name, detected: true, version: first?.trim() }
    } catch {
      return { name, detected: false, hint: `未在 PATH 找到 ${name}，需要时请先安装并加入 PATH。` }
    }
  }

  private positiveInteger(value: number | undefined, fallback: number, field: string): number {
    const selected = value ?? fallback
    if (!Number.isSafeInteger(selected) || selected < 1 || selected > 2_147_483_647) {
      throw new TypeError(`security-rea: ${field} must be a positive safe integer`)
    }
    return selected
  }

  private toolCallTimeout(): number {
    return this.positiveInteger(this.config.toolCallTimeoutMs, 60_000, 'toolCallTimeoutMs')
  }

  private probeTimeout(): number {
    return this.positiveInteger(this.config.probeTimeoutMs, 5_000, 'probeTimeoutMs')
  }

  private startupTimeout(): number {
    return this.positiveInteger(this.config.startupTimeoutMs, 15_000, 'startupTimeoutMs')
  }

  private outputSchemaProfile(): 'full' | 'off' {
    const value = this.config.outputSchemaProfile ?? 'off'
    if (value !== 'full' && value !== 'off') {
      throw new Error(`security-rea Config.outputSchemaProfile must be "full" or "off", got ${JSON.stringify(value)}`)
    }
    return value
  }

  /**
   * Effective MCP tool allowlist: `toolAllowlist` (or the measured
   * static-analysis default) plus `additionalTools`, deduplicated. The
   * filter applies to raw REA names before `mcp__rea__` prefixing.
   */
  private toolFilter(): string[] {
    const base = this.config.toolAllowlist ?? REA_DEFAULT_TOOL_NAMES
    const extras = this.config.additionalTools ?? []
    return [...new Set([...base, ...extras])]
  }
}

export default SecurityRea
