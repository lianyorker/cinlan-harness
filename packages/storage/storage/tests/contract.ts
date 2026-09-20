/**
 * Shared KV-backend conformance suite. Each backend's spec file calls
 * {@link runKvBackendContract} with a factory bound to its own medium; the
 * suite asserts every clause of the `src/backend.ts` contract so both
 * backends are held to identical semantics.
 * @module
 */

import { describe, expect, it } from 'vitest'
import type { KvUnitDescriptor, StorageBackend } from '../src/backend.ts'

/** One conformance run: a fresh backend plus a way to reopen the same medium (crash simulation). */
export interface KvBackendContractHarness {
  /** The backend under test, freshly created over an empty medium. */
  backend: StorageBackend
  /** Open a NEW backend instance over the SAME medium, as after a process restart. */
  reopen(): Promise<StorageBackend>
}

const DESCRIPTOR: KvUnitDescriptor = {
  name: 'contract_unit',
  version: 3,
  tables: ['alpha', 'beta'],
  hasGlobal: true,
}

/**
 * Run the shared conformance suite against one backend implementation.
 * @param label - Suite label, e.g. `json` / `sqlite`.
 * @param create - Factory producing a fresh harness per test.
 */
export function runKvBackendContract(label: string, create: () => Promise<KvBackendContractHarness>) {
  describe(`kv backend contract: ${label}`, () => {
    it('opens a missing unit as empty and serves loadAll immediately', async () => {
      const { backend } = await create()
      const unit = await backend.kv!.open(DESCRIPTOR)
      const snapshot = await unit.loadAll()
      expect(snapshot.tables).toEqual({ alpha: {}, beta: {} })
      expect(snapshot.global).toBeNull()
      await backend.close()
    })

    it('round-trips records and global durably across reopen', async () => {
      const harness = await create()
      const unit = await harness.backend.kv!.open(DESCRIPTOR)
      await unit.putRecord('alpha', 'k1', { n: 1 })
      await unit.putRecord('alpha', 'k2', { n: 2 })
      await unit.putRecord('beta', 'weird key / with:stuff', { ok: true })
      await unit.setGlobal({ counter: 7 })
      await harness.backend.close()

      const reopened = await harness.reopen()
      const unit2 = await reopened.kv!.open(DESCRIPTOR)
      const snapshot = await unit2.loadAll()
      expect(snapshot.tables['alpha']).toEqual({ k1: { n: 1 }, k2: { n: 2 } })
      expect(snapshot.tables['beta']).toEqual({ 'weird key / with:stuff': { ok: true } })
      expect(snapshot.global).toEqual({ counter: 7 })
      await reopened.close()
    })

    it('putRecord overwrites and deleteRecord is idempotent', async () => {
      const { backend } = await create()
      const unit = await backend.kv!.open(DESCRIPTOR)
      await unit.putRecord('alpha', 'k', { v: 'old' })
      await unit.putRecord('alpha', 'k', { v: 'new' })
      await unit.deleteRecord('alpha', 'k')
      await unit.deleteRecord('alpha', 'k')
      await unit.deleteRecord('alpha', 'never-existed')
      const snapshot = await unit.loadAll()
      expect(snapshot.tables['alpha']).toEqual({})
      await backend.close()
    })

    it('rejects a version mismatch on reopen without touching the data', async () => {
      const harness = await create()
      const unit = await harness.backend.kv!.open(DESCRIPTOR)
      await unit.putRecord('alpha', 'k', { v: 1 })
      await harness.backend.close()

      const reopened = await harness.reopen()
      await expect(reopened.kv!.open({ ...DESCRIPTOR, version: 4 })).rejects.toMatchObject({
        name: 'StorageError',
        code: 'version-mismatch',
      })
      // Original version still opens and still holds the data.
      const unit2 = await reopened.kv!.open(DESCRIPTOR)
      expect((await unit2.loadAll()).tables['alpha']).toEqual({ k: { v: 1 } })
      await reopened.close()
    })

    it('reads explicitly compatible versions without advancing the stamp until a durable write', async () => {
      const harness = await create()
      const backend = harness.backend
      try {
        const original = await backend.kv!.open(DESCRIPTOR)
        await original.putRecord('alpha', 'old', { n: 1 })
        await original.setGlobal({ title: 'legacy' })
        await original.close()
        const successor = { ...DESCRIPTOR, version: 4, compatibleVersions: [3] }
        const reader = await backend.kv!.open(successor)
        expect(await reader.loadAll()).toEqual({ tables: { alpha: { old: { n: 1 } }, beta: {} }, global: { title: 'legacy' } })
        await reader.close()
        const untouched = await backend.kv!.open(DESCRIPTOR)
        await untouched.close()
        const writer = await backend.kv!.open(successor)
        await writer.putRecord('alpha', 'new', { execution: { kind: 'local' } })
        await writer.close()
        await expect(backend.kv!.open(DESCRIPTOR)).rejects.toMatchObject({ code: 'version-mismatch' })
      } finally {
        await backend.close()
      }
      const reopened = await harness.reopen()
      try {
        const unit = await reopened.kv!.open({ ...DESCRIPTOR, version: 4 })
        expect(await unit.loadAll()).toEqual({
          tables: { alpha: { old: { n: 1 }, new: { execution: { kind: 'local' } } }, beta: {} },
          global: { title: 'legacy' },
        })
      } finally {
        await reopened.close()
      }
    })

    it('never treats a listed newer stamp as an older compatible version', async () => {
      const { backend } = await create()
      try {
        const unit = await backend.kv!.open({ ...DESCRIPTOR, version: 4 })
        await unit.putRecord('alpha', 'k', { n: 1 })
        await unit.close()
        await expect(backend.kv!.open({ ...DESCRIPTOR, compatibleVersions: [4] })).rejects.toMatchObject({ code: 'version-mismatch' })
        const current = await backend.kv!.open({ ...DESCRIPTOR, version: 4 })
        expect((await current.loadAll()).tables['alpha']).toEqual({ k: { n: 1 } })
      } finally {
        await backend.close()
      }
    })

    it('rejects operations after unit close, and close is idempotent', async () => {
      const { backend } = await create()
      const unit = await backend.kv!.open(DESCRIPTOR)
      await unit.close()
      await unit.close()
      await expect(unit.putRecord('alpha', 'k', {})).rejects.toMatchObject({ code: 'closed' })
      await expect(unit.loadAll()).rejects.toMatchObject({ code: 'closed' })
      await backend.close()
      await backend.close()
    })
  })
}
