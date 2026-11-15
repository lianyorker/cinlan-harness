import { describe, expect, it } from 'vitest'
import {
  buildEnumArgv, buildLoginArgv, buildStorageArgv,
  parseAdUsers, parseAzureSecret, parseLoginRows, parseRoleAssignments, parseStorageAccounts,
} from '../src/azure.ts'

const PRINCIPAL = {
  clientId: '11111111-1111-1111-1111-111111111111',
  tenantId: '22222222-2222-2222-2222-222222222222',
  clientSecret: 'resolved-secret',
} as const

describe('parseAzureSecret', () => {
  it('parses KEY=VALUE lines into a service principal', () => {
    const secret = [
      'AZURE_CLIENT_ID=11111111-1111-1111-1111-111111111111',
      'AZURE_TENANT_ID=22222222-2222-2222-2222-222222222222',
      'AZURE_CLIENT_SECRET=resolved-secret',
      'AZURE_SUBSCRIPTION_ID=33333333-3333-3333-3333-333333333333',
    ].join('\n')
    expect(parseAzureSecret(secret)).toEqual({ ...PRINCIPAL, subscriptionId: '33333333-3333-3333-3333-333333333333' })
  })

  it('rejects unsupported keys, malformed lines, missing keys, and non-GUID ids', () => {
    expect(() => parseAzureSecret('AZURE_CLIENT_ID=A\nNOEQUALS')).toThrow(TypeError)
    expect(() => parseAzureSecret('AWS_ACCESS_KEY_ID=X')).toThrow(TypeError)
    expect(() => parseAzureSecret('AZURE_CLIENT_ID=11111111-1111-1111-1111-111111111111\nAZURE_TENANT_ID=22222222-2222-2222-2222-222222222222')).toThrow(/AZURE_CLIENT_SECRET/)
    expect(() => parseAzureSecret('AZURE_CLIENT_ID=not-a-guid\nAZURE_TENANT_ID=22222222-2222-2222-2222-222222222222\nAZURE_CLIENT_SECRET=s')).toThrow(TypeError)
    expect(() => parseAzureSecret('')).toThrow(TypeError)
  })
})

describe('buildLoginArgv', () => {
  it('builds the service-principal login with JSON output', () => {
    expect(buildLoginArgv('az', { credentialRef: 'ASSESS_AZURE_SP' }, PRINCIPAL)).toEqual([
      'az', 'login', '--service-principal',
      '-u', '11111111-1111-1111-1111-111111111111',
      '-p', 'resolved-secret',
      '-t', '22222222-2222-2222-2222-222222222222',
      '--output', 'json',
    ])
    expect(() => buildLoginArgv('az', { credentialRef: 'bad ref!' }, PRINCIPAL)).toThrow(TypeError)
  })
})

describe('buildEnumArgv and buildStorageArgv', () => {
  it('builds the directory and storage listing calls', () => {
    expect(buildEnumArgv('az', { resource: 'users' })).toEqual(['az', 'ad', 'user', 'list', '--output', 'json'])
    expect(buildEnumArgv('az', { resource: 'role-assignments', subscriptionId: '33333333-3333-3333-3333-333333333333' })).toEqual([
      'az', 'role', 'assignment', 'list', '--output', 'json',
      '--subscription', '33333333-3333-3333-3333-333333333333',
    ])
    expect(buildStorageArgv('az', {})).toEqual([
      'az', 'storage', 'account', 'list', '--output', 'json',
      '--query', '[].{name:name, resourceGroup:resourceGroup, allowBlobPublicAccess:allowBlobPublicAccess, enableHttpsTrafficOnly:enableHttpsTrafficOnly}',
    ])
  })

  it('rejects non-GUID subscription scopes', () => {
    expect(() => buildEnumArgv('az', { resource: 'users', subscriptionId: 'my-subscription' })).toThrow(TypeError)
    expect(() => buildStorageArgv('az', { subscriptionId: '-sub' })).toThrow(TypeError)
  })
})

describe('parseLoginRows', () => {
  it('parses subscription rows, skipping rows without ids', () => {
    const stdout = JSON.stringify([
      { user: { name: '11111111-1111-1111-1111-111111111111', type: 'servicePrincipal' }, tenantId: '22222222-2222-2222-2222-222222222222', subscriptionId: '33333333-3333-3333-3333-333333333333', subscriptionName: 'assess-sub' },
      { tenantId: '22222222-2222-2222-2222-222222222222' },
      'noise',
    ])
    expect(parseLoginRows(stdout)).toEqual([{
      userName: '11111111-1111-1111-1111-111111111111',
      tenantId: '22222222-2222-2222-2222-222222222222',
      subscriptionId: '33333333-3333-3333-3333-333333333333',
      subscriptionName: 'assess-sub',
    }])
  })

  it('returns empty rows for empty or malformed output', () => {
    expect(parseLoginRows('')).toEqual([])
    expect(parseLoginRows('not json')).toEqual([])
    expect(parseLoginRows('{"subscriptionId": "x"}')).toEqual([])
  })
})

describe('parseAdUsers and parseRoleAssignments', () => {
  it('parses directory rows and skips rows without ids', () => {
    const users = JSON.stringify([
      { id: '44444444-4444-4444-4444-444444444444', name: 'Assess User', upn: 'assess-user@example.invalid' },
      { name: 'NoId' },
      'noise',
    ])
    expect(parseAdUsers(users)).toEqual([{ id: '44444444-4444-4444-4444-444444444444', name: 'Assess User', upn: 'assess-user@example.invalid' }])
    const assignments = JSON.stringify([
      { id: '55555555-5555-5555-5555-555555555555', name: 'Reader', principal: '11111111-1111-1111-1111-111111111111', scope: '/subscriptions/33333333' },
      'noise',
    ])
    expect(parseRoleAssignments(assignments)).toEqual([{
      id: '55555555-5555-5555-5555-555555555555', name: 'Reader', principal: '11111111-1111-1111-1111-111111111111', scope: '/subscriptions/33333333',
    }])
  })

  it('returns empty rows for empty or malformed output', () => {
    expect(parseAdUsers('')).toEqual([])
    expect(parseRoleAssignments('not json')).toEqual([])
    expect(parseAdUsers('{"id": "x"}')).toEqual([])
  })
})

describe('parseStorageAccounts', () => {
  it('parses projected account rows and normalizes boolean fields', () => {
    const stdout = JSON.stringify([
      { name: 'assessstorage', resourceGroup: 'assess-rg', allowBlobPublicAccess: true, enableHttpsTrafficOnly: null },
      { resourceGroup: 'assess-rg' },
      'noise',
    ])
    expect(parseStorageAccounts(stdout)).toEqual([
      { name: 'assessstorage', resourceGroup: 'assess-rg', allowBlobPublicAccess: 'true', enableHttpsTrafficOnly: 'unknown' },
    ])
  })

  it('returns empty rows for empty or malformed output', () => {
    expect(parseStorageAccounts('')).toEqual([])
    expect(parseStorageAccounts('not json')).toEqual([])
    expect(parseStorageAccounts('{"name": "x"}')).toEqual([])
  })
})
