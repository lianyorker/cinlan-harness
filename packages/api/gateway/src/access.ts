/** Host-owned authority attached to authenticated carriers, never decoded from Remote payloads. */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { HostConnectionAccess } from '@deepseek-ai/dsh-client-connection'
import type { TypertGatewayAccessPolicy, TypertRemoteEventFrame, TypertRemoteEventInvocation } from './types.ts'

/** Policy storage shared by unary calls and streams for one Gateway lifetime. */
export class GatewayAccess {
  private readonly policies = new WeakMap<object, TypertGatewayAccessPolicy>()
  private readonly current = new AsyncLocalStorage<HostConnectionAccess>()

  /**
   * Attach the delegated policy to its immutable authenticated identity.
   * @param access - authenticated carrier capability.
   * @param policy - owner policy for this exact grant revision.
   * @returns disposer removing only this registration.
   */
  register(access: HostConnectionAccess, policy: TypertGatewayAccessPolicy): () => void {
    if (access.kind !== 'delegated') throw new Error('Gateway policy registration requires delegated access')
    if (this.policies.has(access.identity)) throw new Error('Gateway identity already has a policy')
    this.policies.set(access.identity, policy)
    return () => { if (this.policies.get(access.identity) === policy) this.policies.delete(access.identity) }
  }

  /**
   * Read the authenticated authority retained for this unary invocation.
   * @returns the authenticated caller of the current unary invocation, absent outside dispatch.
   */
  getCurrent(): HostConnectionAccess | undefined { return this.current.getStore() }

  /**
   * Run controller code with the authenticated authority available to local-only management methods.
   * @param access - explicit authority.
   * @param operation - controller invocation.
   * @returns the controller result.
   */
  run<T>(access: HostConnectionAccess, operation: () => T): T {
    this.policy(access)
    return this.current.run(access, operation)
  }

  /**
   * Reject expired/revoked capabilities and delegated identities without a registered policy.
   * @param access - explicit authenticated capability.
   * @returns delegated policy, or undefined for explicit trusted-local access.
   */
  policy(access: HostConnectionAccess): TypertGatewayAccessPolicy | undefined {
    access.signal.throwIfAborted()
    if (access.kind === 'trusted-local') return undefined
    const policy = this.policies.get(access.identity)
    if (policy === undefined) throw new Error('Gateway delegated authority is unavailable')
    return policy
  }

  /**
   * Check a decoded invocation before resolving any provider or lookup.
   * @param access - authenticated capability.
   * @param endpoint - canonical Remote endpoint.
   * @param payload - decoded named arguments.
   */
  async authorize(access: HostConnectionAccess, endpoint: string, payload: unknown): Promise<void> {
    await this.policy(access)?.authorizeInvocation(endpoint, payload)
    access.signal.throwIfAborted()
  }

  /**
   * Project an aggregate result before it leaves the Host.
   * @param access - authenticated capability.
   * @param endpoint - invoked endpoint.
   * @param payload - original decoded request.
   * @param value - owner-produced result.
   * @returns visible result for this authority.
   */
  async result(access: HostConnectionAccess, endpoint: string, payload: unknown, value: unknown): Promise<unknown> {
    const policy = this.policy(access)
    const result = policy === undefined ? value : await policy.projectResult(endpoint, payload, value)
    access.signal.throwIfAborted()
    return result
  }

  /**
   * Filter stream items while preserving cancellation and iterator disposal.
   * @param access - authority retained for the complete stream lifetime.
   * @param endpoint - opened endpoint.
   * @param payload - original decoded request.
   * @param source - owner-produced iterator.
   * @returns only items visible to the caller.
   */
  async *stream(access: HostConnectionAccess, endpoint: string, payload: unknown, source: AsyncIterable<unknown>): AsyncGenerator {
    for await (const value of source) {
      const policy = this.policy(access)
      if (policy === undefined) { yield value; continue }
      const result = await policy.projectStreamItem(endpoint, payload, value)
      access.signal.throwIfAborted()
      if (result !== undefined) yield result
    }
  }

  /**
   * Decide event visibility before adding a delivery or enqueueing a notification.
   * @param access - subscribed capability.
   * @param event - original notification or scoped waterfall invocation.
   * @returns whether the event belongs to this caller's current grant.
   */
  permitsEvent(access: HostConnectionAccess, event: TypertRemoteEventFrame | TypertRemoteEventInvocation): boolean {
    if (access.signal.aborted) return false
    if (access.kind === 'trusted-local') return true
    return this.policies.get(access.identity)?.permitsEvent(event) ?? false
  }
}
