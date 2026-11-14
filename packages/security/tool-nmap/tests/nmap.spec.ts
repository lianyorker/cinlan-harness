import { describe, expect, it } from 'vitest'
import { buildNmapArgv, parseNmapXml } from '../src/nmap.ts'

const FIXTURE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE nmaprun>
<nmaprun scanner="nmap" args="nmap -oX - --open -sV scanme.nmap.org" start="1" version="7.94">
<scaninfo type="syn" protocol="tcp" numservices="1000" services="1-1000"/>
<host starttime="1" endtime="2">
<status state="up" reason="echo-reply" reason_ttl="52"/>
<address addr="45.33.32.156" addrtype="ipv4"/>
<hostnames><hostname name="scanme.nmap.org" type="user"/></hostnames>
<ports>
<port protocol="tcp" portid="22"><state state="open" reason="syn-ack" reason_ttl="52"/><service name="ssh" product="OpenSSH" version="6.6.1p1" extrainfo="Ubuntu 2ubuntu2.13" method="probed" conf="10"/></port>
<port protocol="tcp" portid="80"><state state="open" reason="syn-ack" reason_ttl="52"/><service name="http" product="Apache httpd" version="2.4.7" extrainfo="(Ubuntu)" method="probed" conf="10"/></port>
<port protocol="tcp" portid="9929"><state state="open" reason="syn-ack" reason_ttl="52"/><service name="nping-echo" product="Nping echo" method="table" conf="3"/></port>
</ports>
<times srtt="100000" rttvar="100000" to="100000"/>
<os><osmatch name="Linux 3.8 - 4.6" accuracy="95" line="1"/></os>
</host>
<host starttime="3" endtime="4">
<status state="down" reason="no-response" reason_ttl="0"/>
<address addr="192.0.2.1" addrtype="ipv4"/>
</host>
</nmaprun>`

describe('buildNmapArgv', () => {
  it('builds a minimal argv with XML stdout and --open', () => {
    const argv = buildNmapArgv('/usr/bin/nmap', { target: 'scanme.nmap.org' })
    expect(argv).toEqual(['/usr/bin/nmap', '-oX', '-', '--open', 'scanme.nmap.org'])
  })

  it('adds service detection, OS detection, ports, top-ports and timing', () => {
    const argv = buildNmapArgv('nmap', {
      target: '10.0.0.1',
      ports: '22,80,443',
      serviceDetection: true,
      osDetection: true,
      openOnly: false,
      timing: 4,
    })
    expect(argv).toEqual([
      'nmap', '-oX', '-', '-sV', '-O', '-p', '22,80,443', '-T4', '10.0.0.1',
    ])
    const top = buildNmapArgv('nmap', { target: '10.0.0.1', topPorts: 100 })
    expect(top).toContain('--top-ports')
    expect(top).toContain('100')
  })

  it('rejects option injection, bad ports, and ports+topPorts together', () => {
    expect(() => buildNmapArgv('nmap', { target: '-sV' })).toThrow(TypeError)
    expect(() => buildNmapArgv('nmap', { target: 'host; rm -rf /' })).toThrow(TypeError)
    expect(() => buildNmapArgv('nmap', { target: '10.0.0.1', ports: '22;id' })).toThrow(TypeError)
    expect(() => buildNmapArgv('nmap', { target: '10.0.0.1', ports: '80', topPorts: 10 })).toThrow(TypeError)
    expect(() => buildNmapArgv('nmap', { target: '10.0.0.1', topPorts: 0 })).toThrow(TypeError)
  })
})

describe('parseNmapXml', () => {
  it('parses hosts, ports, services, and OS matches', () => {
    const result = parseNmapXml(FIXTURE_XML)
    expect(result.hostCount).toBe(2)
    expect(result.upCount).toBe(1)
    const up = result.hosts[0]
    expect(up?.address).toBe('45.33.32.156')
    expect(up?.status).toBe('up')
    expect(up?.ports).toHaveLength(3)
    const ssh = up?.ports[0]
    expect(ssh?.port).toBe(22)
    expect(ssh?.service).toBe('ssh')
    expect(ssh?.product).toBe('OpenSSH')
    expect(ssh?.version).toBe('6.6.1p1')
    expect(ssh?.extrainfo).toBe('Ubuntu 2ubuntu2.13')
    expect(ssh?.serviceConf).toBe(10)
    expect(up?.osMatches[0]?.name).toBe('Linux 3.8 - 4.6')
    expect(up?.osMatches[0]?.accuracy).toBe(95)
    const down = result.hosts[1]
    expect(down?.status).toBe('down')
    expect(down?.ports).toHaveLength(0)
  })

  it('returns empty results for malformed or empty XML', () => {
    expect(parseNmapXml('').hosts).toHaveLength(0)
    expect(parseNmapXml('not xml at all').hosts).toHaveLength(0)
    expect(parseNmapXml('<nmaprun></nmaprun>').hosts).toHaveLength(0)
  })
})
