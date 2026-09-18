/** Desktop installer configuration validation against the installed packager schema. */

/**
 * Validate all platform sections using the installed electron-builder schema.
 * @param config - Configuration returned by the Desktop factory.
 * @returns Nothing.
 * @throws When the installed schema rejects a configuration field.
 */
export function validateDesktopElectronBuilderConfig(config: unknown): void
