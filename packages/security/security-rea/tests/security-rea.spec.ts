import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertReaEnvironment,
  assessReaReadiness,
  evaluateNodeEngines,
  parseNodeVersion,
  probeNode,
  resolveReaArtifact,
  SecurityRea,
} from '../src/index.ts'

const REA_ENGINES = '^22.23.4 || ^24.22.1 || >=26.12.1'

describe('parseNodeVersion', () => {
  it('parses version output', () => {
    expect(parseNodeVersion('v24.22.2')).toEqual({ major: 24, minor: 22, patch: 2 })
    expect(parseNodeVersion('24.9.0')).toEqual({ major: 24, minor: 9, patch: 0 })
    expect(parseNodeVersion('not a version')).toBeUndefined()
  })
})

describe('evaluateNodeEngines', () => {
  it('satisfies the rea-agents range on the supported floors', () => {
    expect(evaluateNodeEngines({ major: 24, minor: 22, patch: 2 }, REA_ENGINES)).toBe('satisfied')
    expect(evaluateNodeEngines({ major: 22, minor: 23, patch: 4 }, REA_ENGINES)).toBe('satisfied')
    expect(evaluateNodeEngines({ major: 26, minor: 12, patch: 1 }, REA_ENGINES)).toBe('satisfied')
    expect(evaluateNodeEngines({ major: 28, minor: 0, patch: 0 }, REA_ENGINES)).toBe('satisfied')
  })

  it('rejects versions below every alternative', () => {
    expect(evaluateNodeEngines({ major: 24, minor: 22, patch: 0 }, REA_ENGINES)).toBe('unsatisfied')
    expect(evaluateNodeEngines({ major: 24, minor: 9, patch: 0 }, REA_ENGINES)).toBe('unsatisfied')
    expect(evaluateNodeEngines({ major: 22, minor: 23, patch: 3 }, REA_ENGINES)).toBe('unsatisfied')
    expect(evaluateNodeEngines({ major: 25, minor: 0, patch: 0 }, REA_ENGINES)).toBe('unsatisfied')
    expect(evaluateNodeEngines({ major: 26, minor: 12, patch: 0 }, REA_ENGINES)).toBe('unsatisfied')
  })

  it('reports unknown for unrecognized ranges instead of failing closed', () => {
    expect(evaluateNodeEngines({ major: 24, minor: 22, patch: 2 }, 'nonsense')).toBe('unknown')
    expect(evaluateNodeEngines({ major: 24, minor: 22, patch: 2 }, '24.x')).toBe('unknown')
  })
})

describe('assessReaReadiness', () => {
  const base = {
    nodeExecutable: 'C:/runtime/node.exe',
    nodeVersion: { major: 24, minor: 22, patch: 2 },
    nodeVersionText: 'v24.22.2',
    enginesRange: REA_ENGINES,
    reaVersion: '6.8.0',
    reaPackageFound: true,
  }

  it('launches when every fact is satisfied', () => {
    expect(assessReaReadiness(base)).toEqual({ kind: 'launch' })
  })

  it('disables without nodeExecutable', () => {
    expect(assessReaReadiness({ ...base, nodeExecutable: undefined }))
      .toEqual({ kind: 'disabled', reason: 'not-configured' })
    expect(assessReaReadiness({ ...base, nodeExecutable: '  ' }))
      .toEqual({ kind: 'disabled', reason: 'not-configured' })
  })

  it('refuses a missing rea package', () => {
    const verdict = assessReaReadiness({ ...base, reaPackageFound: false })
    expect(verdict).toMatchObject({ kind: 'unavailable', reason: 'rea-package-missing' })
  })

  it('refuses when the node probe never produced a version', () => {
    const verdict = assessReaReadiness({ ...base, nodeVersion: undefined })
    expect(verdict).toMatchObject({ kind: 'unavailable', reason: 'node-probe-failed' })
  })

  it('refuses an unsatisfied runtime with a plain-language detail', () => {
    const verdict = assessReaReadiness({
      ...base,
      nodeVersion: { major: 24, minor: 9, patch: 0 },
      nodeVersionText: 'v24.9.0',
    })
    expect(verdict).toMatchObject({
      kind: 'unavailable',
      reason: 'engines-unsatisfied',
      nodeVersion: 'v24.9.0',
      requiredEngines: REA_ENGINES,
    })
    if (verdict.kind !== 'unavailable') throw new Error('expected unavailable')
    expect(verdict.detail).toContain('逆向分析需要更新运行时')
    expect(verdict.detail).toContain('24.9.0')
  })

  it('refuses honestly when the engines range cannot be evaluated', () => {
    const verdict = assessReaReadiness({ ...base, enginesRange: 'nonsense' })
    expect(verdict).toMatchObject({ kind: 'unavailable', reason: 'engines-unknown' })
  })

  it('still launches when the package omits an engines range', () => {
    expect(assessReaReadiness({ ...base, enginesRange: undefined })).toEqual({ kind: 'launch' })
  })
})

describe('assertReaEnvironment', () => {
  it('accepts a clh-shaped state dir and clean env', () => {
    expect(() => assertReaEnvironment({}, 'C:/Users/test/.clh/security/rea')).not.toThrow()
    expect(() => assertReaEnvironment({ REA_LOG_DIR: 'C:/Users/test/.clh/security/rea/logs' }, 'C:/Users/test/.clh/security/rea')).not.toThrow()
  })

  it('rejects .dsh state dirs and forwarded DSH_* env', () => {
    expect(() => assertReaEnvironment({}, 'C:/Users/test/.dsh/security/rea')).toThrow(TypeError)
    expect(() => assertReaEnvironment({ DSH_HOME: 'C:/x' }, 'C:/ok')).toThrow(TypeError)
    expect(() => assertReaEnvironment({ SOME_DIR: 'C:/Users/test/.dsh/x' }, 'C:/ok')).toThrow(TypeError)
  })
})

describe('probeNode', () => {
  const scratch: string[] = []

  afterEach(() => {
    while (scratch.length > 0) rmSync(scratch.pop() as string, { recursive: true, force: true })
  })

  it('returns nothing for a missing executable', () => {
    expect(probeNode('C:/definitely/missing/node.exe', 1000)).toEqual({})
  })

  it('returns nothing for an executable that is not node', () => {
    const dir = mkdtempSync(join(tmpdir(), 'security-rea-'))
    scratch.push(dir)
    const fake = join(dir, 'fake.js')
    writeFileSync(fake, 'process.exit(0)')
    expect(probeNode(fake, 1000)).toEqual({})
  })

  it('parses the real node runtime when available', () => {
    const probed = probeNode(process.execPath, 5000)
    expect(probed.version).toEqual({
      major: Number(process.versions.node.split('.')[0]),
      minor: Number(process.versions.node.split('.')[1]),
      patch: Number(process.versions.node.split('.')[2]),
    })
  })
})

const STUB_SERVER = fileURLToPath(new URL('./fixtures/rea-stub-server.mjs', import.meta.url))
const HANG_SERVER = fileURLToPath(new URL('./fixtures/rea-stub-hang-server.mjs', import.meta.url))
const ENV_SERVER = fileURLToPath(new URL('./fixtures/rea-stub-env-server.mjs', import.meta.url))

/**
 * Build a Cordis context with a tracked stub of the tools service plus a
 * minimal skills stub; `SecurityRea` requires both through `static inject`.
 * The real ToolRuntime registration path is covered by the rea-routing
 * snapshot end-to-end.
 */
function securityReaContext(): { ctx: Context; registeredTools: Set<string> } {
  const ctx = new Context()
  const registeredTools = new Set<string>()
  ctx.reflect.provide('tools', {
    register: (definition: { name: string }) => {
      registeredTools.add(definition.name)
      return () => { registeredTools.delete(definition.name) }
    },
  })
  ctx.reflect.provide('skills', { register: () => () => {} })
  return { ctx, registeredTools }
}

describe('SecurityRea service', () => {
  const scratch: string[] = []

  afterEach(() => {
    while (scratch.length > 0) rmSync(scratch.pop() as string, { recursive: true, force: true })
  })

  it('registers the stub server tools and reports ready with a tool count', async () => {
    const { ctx, registeredTools } = securityReaContext()
    const stateDir = mkdtempSync(join(tmpdir(), 'security-rea-state-'))
    scratch.push(stateDir)
    try {
      const service = new SecurityRea(ctx, {
        nodeExecutable: process.execPath,
        reaScript: STUB_SERVER,
        stateDir,
        startupTimeoutMs: 20_000,
      })
      await service[Service.init]()
      const status = service.status()
      expect(status.state).toBe('ready')
      // The stub lists six tools but instrument_with_frida is absent from
      // REA_DEFAULT_TOOL_NAMES, so only the five static tools register.
      expect(status.toolCount).toBe(5)
      expect([...registeredTools].filter(name => name.startsWith('mcp__rea__'))).toHaveLength(5)
      expect([...registeredTools]).toContain('mcp__rea__binary_overview')
      expect([...registeredTools]).not.toContain('mcp__rea__instrument_with_frida')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('admits a dynamic-lane tool listed in additionalTools', async () => {
    const { ctx, registeredTools } = securityReaContext()
    const stateDir = mkdtempSync(join(tmpdir(), 'security-rea-state-'))
    scratch.push(stateDir)
    try {
      const service = new SecurityRea(ctx, {
        nodeExecutable: process.execPath,
        reaScript: STUB_SERVER,
        stateDir,
        startupTimeoutMs: 20_000,
        additionalTools: ['instrument_with_frida'],
      })
      await service[Service.init]()
      expect([...registeredTools]).toContain('mcp__rea__instrument_with_frida')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('replaces the allowlist completely when toolAllowlist is set', async () => {
    const { ctx, registeredTools } = securityReaContext()
    const stateDir = mkdtempSync(join(tmpdir(), 'security-rea-state-'))
    scratch.push(stateDir)
    try {
      const service = new SecurityRea(ctx, {
        nodeExecutable: process.execPath,
        reaScript: STUB_SERVER,
        stateDir,
        startupTimeoutMs: 20_000,
        toolAllowlist: ['open_binary', 'instrument_with_frida'],
      })
      await service[Service.init]()
      const registered = [...registeredTools].filter(name => name.startsWith('mcp__rea__'))
      expect(registered.sort()).toEqual(['mcp__rea__instrument_with_frida', 'mcp__rea__open_binary'])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('degrades to unavailable on a server that never answers instead of hanging', async () => {
    const { ctx } = securityReaContext()
    const stateDir = mkdtempSync(join(tmpdir(), 'security-rea-state-'))
    scratch.push(stateDir)
    try {
      // Activation must resolve: startupTimeoutMs bounds the handshake wait.
      const service = new SecurityRea(ctx, {
        nodeExecutable: process.execPath,
        reaScript: HANG_SERVER,
        stateDir,
        startupTimeoutMs: 100,
      })
      await service[Service.init]()
      const status = service.status()
      expect(status.state).toBe('unavailable')
      expect(status.reason).toBe('startup-timeout')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each([
    { configured: undefined, expected: 'off' },
    { configured: 'full' as const, expected: 'full' },
  ])('passes REA_MCP_OUTPUT_SCHEMA_PROFILE=$expected to the spawned server', async ({ configured, expected }) => {
    const { ctx } = securityReaContext()
    const stateDir = mkdtempSync(join(tmpdir(), 'security-rea-state-'))
    scratch.push(stateDir)
    const probeOut = join(stateDir, 'probe.env')
    const previous = process.env.REA_ENV_PROBE_OUT
    process.env.REA_ENV_PROBE_OUT = probeOut
    try {
      const service = new SecurityRea(ctx, {
        nodeExecutable: process.execPath,
        reaScript: ENV_SERVER,
        stateDir,
        startupTimeoutMs: 500,
        ...(configured === undefined ? {} : { outputSchemaProfile: configured }),
      })
      await service[Service.init]()
      expect(readFileSync(probeOut, 'utf8')).toBe(expected)
    } finally {
      if (previous === undefined) delete process.env.REA_ENV_PROBE_OUT
      else process.env.REA_ENV_PROBE_OUT = previous
      await ctx.fiber.dispose()
    }
  })

  it('refuses an invalid outputSchemaProfile at launch', async () => {
    const { ctx } = securityReaContext()
    const stateDir = mkdtempSync(join(tmpdir(), 'security-rea-state-'))
    scratch.push(stateDir)
    try {
      expect(() => new SecurityRea(ctx, {
        nodeExecutable: process.execPath,
        reaScript: STUB_SERVER,
        stateDir,
        outputSchemaProfile: 'bogus' as 'off',
      })).toThrow('outputSchemaProfile')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('refuses a missing reaScript with the package-missing classification', async () => {
    const { ctx } = securityReaContext()
    const stateDir = mkdtempSync(join(tmpdir(), 'security-rea-state-'))
    scratch.push(stateDir)
    try {
      const service = new SecurityRea(ctx, {
        nodeExecutable: process.execPath,
        reaScript: join(stateDir, 'absent-server.mjs'),
        stateDir,
      })
      await service[Service.init]()
      const status = service.status()
      expect(status.state).toBe('unavailable')
      expect(status.reason).toBe('rea-package-missing')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('real REA connectivity (local smoke)', () => {
  /**
   * Pick the first runnable Node satisfying the pinned rea-agents engines:
   * REA_SMOKE_NODE override, then the current runtime. Absent both, the smoke
   * self-skips — it is a local verification lane, not a snapshot.
   */
  function smokeNode(): string | undefined {
    const candidates = [process.env.REA_SMOKE_NODE, process.execPath]
    for (const candidate of candidates) {
      if (candidate === undefined || !existsSync(candidate)) continue
      let artifact
      try {
        artifact = resolveReaArtifact()
      } catch {
        return undefined
      }
      const probed = probeNode(candidate, 10_000)
      if (probed.version === undefined) continue
      if (artifact.enginesRange === undefined
        || evaluateNodeEngines(probed.version, artifact.enginesRange) === 'satisfied') return candidate
    }
    return undefined
  }

  it('reaches ready and registers real mcp__rea__ tools', async (testCtx) => {
    const nodeExecutable = smokeNode()
    if (nodeExecutable === undefined) {
      testCtx.skip('no Node runtime satisfying the rea-agents engines range found')
    }
    const stateDir = mkdtempSync(join(tmpdir(), 'security-rea-state-'))
    const { ctx } = securityReaContext()
    try {
      const service = new SecurityRea(ctx, {
        ...(nodeExecutable === undefined ? {} : { nodeExecutable }),
        stateDir,
        startupTimeoutMs: 30_000,
      })
      await service[Service.init]()
      const status = service.status()
      expect(status.state).toBe('ready')
      expect(status.toolCount).toBeGreaterThan(100)
    } finally {
      rmSync(stateDir, { recursive: true, force: true })
      await ctx.fiber.dispose()
    }
  }, 60_000)
})
