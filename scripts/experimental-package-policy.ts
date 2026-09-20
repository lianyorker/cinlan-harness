/** Exact upstream experimental imports admitted to the shared dsh release. */
export const PUBLIC_EXPERIMENTAL_PACKAGES: Readonly<Record<string, string>> = {
  'packages/experimental/auto-review': '@deepseek-ai/dsh-experimental-auto-review',
  'packages/experimental/browser-use-runtime': '@deepseek-ai/dsh-experimental-browser-use-runtime',
  'packages/experimental/browser-use-playwright-mcp': '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp',
  'packages/experimental/browser-use-chrome-devtools-mcp': '@deepseek-ai/dsh-experimental-browser-use-chrome-devtools-mcp',
  'packages/experimental/browser-use-stagehand-native': '@deepseek-ai/dsh-experimental-browser-use-stagehand-native',
  'packages/experimental/computer-use-cua-driver-mcp': '@deepseek-ai/dsh-experimental-computer-use-cua-driver-mcp',
  'packages/experimental/computer-use-cua-driver-native': '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native',
}

/**
 * Match an official experimental import by both directory and npm name.
 * @param directory - repository-relative package directory, using forward slashes.
 * @param name - the package's declared npm name.
 * @returns Whether the package belongs to the public experimental allowlist.
 */
export function isPublicExperimentalPackage(directory: string, name: string | undefined): boolean {
  const expected = PUBLIC_EXPERIMENTAL_PACKAGES[directory]
  return expected !== undefined && name === expected
}
