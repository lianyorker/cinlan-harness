/** sherpa-onnx-node profile-repair detection tests, mirroring pty-deps.spec.ts's findProfileDir/buildRepairCommand coverage. */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { engineRepairHint, findProfileDir } from '../src/engine-repair.ts'

describe('findProfileDir', () => {
  let root: string
  let moduleFile: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'voice-sherpa-onnx-repair-'))
    const packageRoot = join(root, 'profiles', 'web', 'node_modules', '.pnpm', 'sherpa-onnx-node@1.13.6', 'node_modules', 'sherpa-onnx-node')
    const library = join(packageRoot, 'lib')
    mkdirSync(library, { recursive: true })
    writeFileSync(join(root, 'profiles', 'web', 'package.json'), JSON.stringify({ name: 'dsh-profile-web' }))
    writeFileSync(join(root, 'profiles', 'web', 'pnpm-workspace.yaml'), '')
    moduleFile = join(library, 'index.js')
    writeFileSync(moduleFile, '')
  })

  afterEach(() => { rmSync(root, { recursive: true, force: true }) })

  it('walks up from the module to the profile root', () => {
    expect(findProfileDir(moduleFile)).toBe(realpathSync(join(root, 'profiles', 'web')))
  })

  it('falls back to DSH_HOME/profiles/web', () => {
    const home = join(root, 'home')
    const web = join(home, 'profiles', 'web')
    mkdirSync(web, { recursive: true })
    writeFileSync(join(web, 'package.json'), JSON.stringify({ name: 'dsh-profile-web' }))
    writeFileSync(join(web, 'pnpm-workspace.yaml'), '')
    const bareModule = join(root, 'elsewhere', 'lib', 'index.js')
    mkdirSync(dirname(bareModule), { recursive: true })
    writeFileSync(bareModule, '')
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      expect(findProfileDir(bareModule)).toBe(realpathSync(web))
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('resolves neither the walk nor the fallback to null', () => {
    const bareModule = join(root, 'nowhere', 'lib', 'index.js')
    mkdirSync(dirname(bareModule), { recursive: true })
    writeFileSync(bareModule, '')
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, 'no-such-home')
    try {
      expect(findProfileDir(bareModule)).toBeNull()
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})

describe('engineRepairHint', () => {
  it('targets the detected profile through the repository CLI', () => {
    const root = mkdtempSync(join(tmpdir(), 'voice-sherpa-onnx-repair-'))
    try {
      const profileDir = join(root, 'profiles', 'cinlan')
      mkdirSync(profileDir, { recursive: true })
      writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'dsh-profile-cinlan' }))
      writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), '')
      const moduleFile = join(profileDir, 'node_modules', 'x', 'lib', 'index.js')
      mkdirSync(dirname(moduleFile), { recursive: true })
      writeFileSync(moduleFile, '')
      const hint = engineRepairHint(moduleFile)
      expect(hint.profile).toBe('cinlan')
      expect(hint.command).toBe('dsh plugin --profile "cinlan" install')
      expect(hint.note).toContain('allowBuilds: sherpa-onnx-node: true')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('targets the standard web profile when no profile is detected', () => {
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'voice-sherpa-onnx-repair-no-home-'))
    try {
      const hint = engineRepairHint(join(process.env.DSH_HOME, 'nowhere', 'lib', 'index.js'))
      expect(hint.profile).toBeNull()
      expect(hint.command).toBe('dsh plugin --profile "web" install')
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
