# `@cinlan/mobile-relay`

This private package provides the self-hosted Cinlan Director, Cell, combined relay runtime, versioned mobile protocol, and static mobile application server. Start it through the `dsh --profile mobile-relay` profile; do not invoke the package entry point as a standalone public server.

The combined profile is suitable for a local development node. Production deployments use one Director with one or more Cells. Each Cell receives signed short-lived leases, enforces host and connection capacity, and forwards opaque encrypted frames. Set a private `stateFile`, unique `regionId`, explicit `regions`, and an enrollment token for remote Cell admission.

Example profile configuration:

```yaml
- id: cinlan-mobile-relay
  config:
    role: combined
    host: 127.0.0.1
    port: 8088
    publicUrl: http://127.0.0.1:8088
    stateFile: .dsh/cinlan-relay/state.json
    regionId: local
    maxHosts: 1000
```

Use HTTPS and `allowInsecureNetwork: false` for non-loopback URLs. The relay does not expose the operator API and does not decrypt mobile application traffic.
