# Agent Note: Explicit SSH client transport

Status: implemented

English | [中文](2026-09-17-explicit-ssh-client-transport.zh.md)

## Problem

Windows OpenSSH does not provide the local control-master and Unix forwarding arrangement used by the [POSIX execution providers](2026-09-11-posix-ssh-runtime.md). A Windows Harness still needs authenticated administrative traffic and independent binary streams to the installed POSIX helper. Target inspection cannot substitute for those execution capabilities.

## Decision

The connection owner selects either a POSIX OpenSSH alias or an explicit SSH endpoint. The explicit transport uses maintained SSH2 exec and streamlocal channels, reads only the configured private-key file, and requires a configured SHA-256 server-key fingerprint. It discovers no user SSH configuration or agent identity. The remote helper protocol, digest checks, TLS-PSK stream authentication, heartbeat lease and provider interfaces remain shared.

Channel cancellation retains ownership until a late allocation is closed or the connection is lost. An unresponsive channel-open deadline invalidates the connection because the remote allocation cannot be confirmed. Unpublished cancelled channels drain their readable EOF before settlement; accepted streams transfer cancellation to their TLS wrapper.

## Alternatives considered

**Require WSL or a local Unix proxy.** This adds a second execution environment or local listener solely to reproduce OpenSSH control sockets. Direct streamlocal channels preserve the existing remote endpoint protocol without that deployment dependency.

**Move streams into the management RPC.** Multiplexing bytes inside the helper protocol would need new flow control and couples ordinary output to control progress. Independent SSH channels retain the existing ownership and authentication decisions.

## Consequences

Windows is supported as a client, while remote helpers and their filesystem/process/sandbox providers remain POSIX. Explicit endpoints require unencrypted configured private keys and trusted fingerprint distribution. Automatic provisioning, remote Windows execution, reconnect and mutation replay are not supplied. The [inspection-authority decision](2026-09-17-ssh-inspection-authority.md) remains active: target inspection does not mount execution providers or create remote Session authority.

The POSIX provider decision remains active for reservations, file-effect policy, authenticated streams and unknown disconnected outcomes. Only its client transport restriction is extended; neither active note is fully superseded.

## Verification

Local SSH2 server fixtures use generated keys, encrypted loopback connections, a real protocol child, and TLS-PSK stream endpoints. They cover accepted traffic, host-key refusal, stream-capability refusal, late cancellation and disposal during channel allocation. These tests establish client transport behavior on Windows; a configured Linux/macOS remote remains required for native helper, filesystem, process and sandbox acceptance.
