import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { pairingPage } from '../src/pairing-page.ts'

function pageScript(): string {
  const script = /<script>([\s\S]*)<\/script>/.exec(pairingPage())?.[1]
  if (script === undefined) throw new Error('Pairing page script is missing')
  return script
}

function runPage(hash: string, search = '') {
  const events: string[] = []
  const historyCalls: unknown[][] = []
  const elements = new Map<string, { textContent: string; value: string; disabled: boolean; addEventListener: () => void }>([
    ['title', { textContent: '', value: '', disabled: false, addEventListener: () => {} }],
    ['instructions', { textContent: '', value: '', disabled: false, addEventListener: () => {} }],
    ['invitationLabel', { textContent: '', value: '', disabled: false, addEventListener: () => {} }],
    ['codeLabel', { textContent: '', value: '', disabled: false, addEventListener: () => {} }],
    ['nameLabel', { textContent: '', value: '', disabled: false, addEventListener: () => {} }],
    ['invitation', { textContent: '', value: '', disabled: false, addEventListener: () => {} }],
    ['code', { textContent: '', value: '', disabled: false, addEventListener: () => {} }],
    ['name', { textContent: '', value: '', disabled: false, addEventListener: () => {} }],
    ['submit', { textContent: '', value: '', disabled: false, addEventListener: () => {} }],
    ['status', { textContent: '', value: '', disabled: false, addEventListener: () => {} }],
    ['pair', { textContent: '', value: '', disabled: false, addEventListener: () => {} }],
  ])
  const document = {
    title: '',
    getElementById(id: string) {
      events.push(`element:${id}`)
      const element = elements.get(id)
      if (element === undefined) throw new Error(`Missing fixture element ${id}`)
      return element
    },
  }
  const location = { hash, pathname: '/pair', search }
  const history = { replaceState(...args: unknown[]) { events.push('replaceState'); historyCalls.push(args) } }
  runInNewContext(pageScript(), { URLSearchParams, document, location, history, navigator: { language: 'en-US' } })
  return { elements, events, historyCalls, document }
}

describe('pairing page fragment bootstrap', () => {
  it('prefills both invitation fields and scrubs the fragment before DOM work', () => {
    const result = runPage('#invitationId=invite%2Fone&code=001002003')
    expect(result.elements.get('invitation')?.value).toBe('invite/one')
    expect(result.elements.get('code')?.value).toBe('001002003')
    expect(result.historyCalls).toEqual([[null, '', '/pair']])
    expect(result.events[0]).toBe('replaceState')
  })

  it('does not read or preserve query credentials', () => {
    const html = pairingPage()
    expect(html).not.toContain('location.search')
    expect(html).not.toMatch(/\/pair\?/)
    const result = runPage('#invitationId=invite-1&code=482915000', '?invitationId=query-secret&code=query-secret')
    expect(result.historyCalls).toEqual([[null, '', '/pair']])
    expect(result.elements.get('invitation')?.value).toBe('invite-1')
    expect(result.elements.get('code')?.value).toBe('482915000')
  })

  it('ignores oversized invitation IDs and malformed one-time codes', () => {
    const result = runPage(`#invitationId=${'x'.repeat(37)}&code=12345678a`)
    expect(result.elements.get('invitation')?.value).toBe('')
    expect(result.elements.get('code')?.value).toBe('')
    expect(result.historyCalls).toEqual([[null, '', '/pair']])
  })
})
