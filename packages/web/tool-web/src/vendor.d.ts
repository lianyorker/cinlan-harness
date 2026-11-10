/**
 * Ambient declarations for dependencies that ship no TypeScript types.
 * `@joplin/turndown-plugin-gfm` exports a single turndown plugin function;
 * its exact parameter type comes from turndown's own `Plugin` alias.
 */

declare module '@joplin/turndown-plugin-gfm' {
  import type turndown from 'turndown'

  export const gfm: turndown.Plugin
}
