/** Client transports carry the unchanged helper protocol and independent byte streams. */
import type { Duplex, Readable, Writable } from 'node:stream'

/** Administrative byte pipes owned by one SSH session. */
export interface SshControl { readonly input: Readable; readonly output: Writable }

/** Transport ownership ends only after its channels and local processes settle. */
export interface SshTransport {
  /** Start the installed helper command over the authenticated connection.
   * @param command - Quoted remote POSIX command.
   * @param signal - Startup cancellation.
   * @returns Administrative pipes owned by the transport.
   */
  openControl(command: string, signal: AbortSignal): Promise<SshControl>
  /** Open one remote Unix socket without changing the helper's endpoint protocol.
   * @param path - Validated remote endpoint pathname.
   * @param signal - Allocation cancellation; late channels remain owned until closed.
   * @returns Connected bytes ready for TLS authentication.
   */
  openStream(path: string, signal: AbortSignal): Promise<Duplex>
  /** Begin terminating the SSH session after an owned failure. */
  stop(): void
  /** Terminate and join the SSH session and transport-owned cleanup.
   * @returns Completion after all transport resources settle.
   */
  close(): Promise<void>
}
