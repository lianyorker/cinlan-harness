/** Desktop shell dependency selection checked before release preparation. */

/**
 * Reject pnpm output that selects other projects or omits direct shell dependencies.
 * @param tree - Parsed production dependency listing from pnpm.
 * @returns Nothing.
 * @throws When the listing does not select the Desktop package and its required roots.
 */
export function assertDesktopDependencySelection(tree: unknown): void
