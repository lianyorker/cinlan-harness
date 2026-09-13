/** Pure inventory-to-status derivation used by every capability section. */
import { describe, expect, it } from 'vitest'
import type { PluginEntryId } from '@deepseek-ai/dsh-host-plugin-inventory/types'
import { capabilityComponents, capabilityStatus, type InventoryEntry } from '../src/client/view.ts'

function entry(moduleName: string, fiberPhase: InventoryEntry['fiberPhase']): InventoryEntry {
  return {
    entryId: moduleName as PluginEntryId,
    moduleName,
    enabled: true,
    fiberPhase,
  }
}

const SECURITY_MATCHER = /security|skill|finding|mcp/i

describe('capabilityComponents', () => {
  it('groups matching entries by exact module specifier', () => {
    const skillA = entry('@deepseek-ai/dsh-security-skills', 'active')
    const skillB = entry('@deepseek-ai/dsh-security-skills', 'active')
    const finding = entry('@deepseek-ai/dsh-finding-session', 'active')
    const components = capabilityComponents([skillA, skillB, finding], SECURITY_MATCHER)
    expect(components).toEqual([
      { moduleName: '@deepseek-ai/dsh-security-skills', entries: [skillA, skillB], status: 'ready' },
      { moduleName: '@deepseek-ai/dsh-finding-session', entries: [finding], status: 'ready' },
    ])
  })

  it('excludes entries the capability matcher does not claim', () => {
    const components = capabilityComponents([entry('@deepseek-ai/dsh-browser', 'active')], SECURITY_MATCHER)
    expect(components).toEqual([])
  })

  it('marks a component loading while any entry has not settled active', () => {
    const components = capabilityComponents([entry('@deepseek-ai/dsh-security-skills', 'pending')], SECURITY_MATCHER)
    expect(components[0]).toMatchObject({ status: 'loading' })
  })

  it('marks a component needing attention when any entry failed, even alongside active ones', () => {
    const components = capabilityComponents(
      [entry('@deepseek-ai/dsh-security-skills', 'active'), entry('@deepseek-ai/dsh-security-skills', 'failed')],
      SECURITY_MATCHER,
    )
    expect(components[0]).toMatchObject({ status: 'attention' })
  })
})

describe('capabilityStatus', () => {
  it('reports missing when no component matched', () => {
    expect(capabilityStatus([])).toBe('missing')
  })

  it('reports ready only when every component is ready', () => {
    const components = capabilityComponents([entry('@deepseek-ai/dsh-security-skills', 'active')], SECURITY_MATCHER)
    expect(capabilityStatus(components)).toBe('ready')
  })

  it('reports loading when a component has not settled, absent any failure', () => {
    const components = capabilityComponents([entry('@deepseek-ai/dsh-security-skills', 'pending')], SECURITY_MATCHER)
    expect(capabilityStatus(components)).toBe('loading')
  })

  it('gives a failed component precedence over ready ones', () => {
    const components = capabilityComponents(
      [entry('@deepseek-ai/dsh-security-skills', 'active'), entry('@deepseek-ai/dsh-finding-session', 'failed')],
      SECURITY_MATCHER,
    )
    expect(capabilityStatus(components)).toBe('attention')
  })
})


it('does not count disabled entries as loaded or waiting components', () => {
  expect(capabilityComponents([{ ...entry('@deepseek-ai/dsh-security-skills', 'pending'), enabled: false }], SECURITY_MATCHER)).toEqual([])
})
