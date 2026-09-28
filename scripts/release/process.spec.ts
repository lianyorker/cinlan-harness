import { describe, expect, it } from 'vitest'
import { capture, pnpmCommand } from './process.ts'

describe('release process helpers', () => {
  it('runs pnpm through a JavaScript entry that spawnSync can start on Windows', () => {
    const [command, ...args] = pnpmCommand()
    expect(command === 'pnpm' || /node(?:\.exe)?$/iu.test(command)).toBe(true)
    if (command !== 'pnpm') expect(args[0]).toMatch(/pnpm/u)
    expect(capture(command, [...args, '--version'])).toMatch(/^\d+\.\d+\.\d+/u)
  })
})
