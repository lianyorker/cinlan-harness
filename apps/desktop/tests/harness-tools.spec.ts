/** Desktop-local tools retain their registry ownership and report execution failures. */
import { describe, expect, it } from 'vitest'
import { MemoryToolRegistry } from '../src/harness/tools/registry.ts'
import type { Tool } from '../src/harness/tools/types.ts'

describe('local Harness tools', () => {
  it('registers, replaces, and unregisters tools by name', async () => {
    const registry = new MemoryToolRegistry()
    const first: Tool = { definition: { name: 'echo', description: 'Echo', parameters: [] },
      execute: args => Promise.resolve({ success: true, output: args.text }) }
    registry.register(first)
    expect(registry.get('echo')).toBe(first)
    expect(registry.list()).toEqual([first.definition])
    await expect(registry.execute('echo', { text: 'first' })).resolves.toEqual({ success: true, output: 'first' })
    const replacement: Tool = { definition: first.definition,
      execute: () => Promise.resolve({ success: true, output: 'replacement' }) }
    registry.register(replacement)
    expect(registry.get('echo')).toBe(replacement)
    expect(registry.list()).toHaveLength(1)
    await expect(registry.execute('echo', {})).resolves.toEqual({ success: true, output: 'replacement' })
    registry.unregister('echo')
    expect(registry.get('echo')).toBeUndefined()
    expect(registry.list()).toEqual([])
    await expect(registry.execute('echo', {})).resolves.toEqual({ success: false, error: 'Tool not found: echo' })
    registry.unregister('echo')
  })

  it('reports rejected tool errors and non-Error rejections', async () => {
    const registry = new MemoryToolRegistry()
    for (const error of [new Error('failed'), 'failed']) {
      registry.register({ definition: { name: 'failure', description: 'Fail', parameters: [] },
        // eslint-disable-next-line typescript/prefer-promise-reject-errors -- Test non-Error tool rejections.
        execute: () => Promise.reject(error) })
      await expect(registry.execute('failure', {})).resolves.toEqual({ success: false, error: 'failed' })
    }
  })
})
