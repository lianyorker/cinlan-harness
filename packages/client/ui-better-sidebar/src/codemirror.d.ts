/* oxlint-disable typescript/no-explicit-any -- installed @codemirror tarballs ship no .d.ts; shim until upstream types land. */
declare module '@codemirror/view' {
  export const EditorView: any
  export const keymap: any
  export const lineNumbers: any
  export const highlightActiveLine: any
  export const highlightSpecialChars: any
  export const rectangularSelection: any
  export const crosshairCursor: any
  export const drawSelection: any
  export const dropCursor: any
  export type EditorView = any
  export type ViewUpdate = any
}

declare module '@codemirror/legacy-modes/mode/shell' {
  export const shell: any
}

declare module '@codemirror/legacy-modes/mode/toml' {
  export const toml: any
}

declare module '@codemirror/legacy-modes/mode/nginx' {
  export const nginx: any
}

declare module '@codemirror/legacy-modes/mode/dockerfile' {
  export const dockerFile: any
}

declare module '@codemirror/legacy-modes/mode/properties' {
  export const properties: any
}

declare module '@codemirror/legacy-modes/mode/clike' {
  export const csharp: any
  export const kotlin: any
}

declare module '@codemirror/legacy-modes/mode/swift' {
  export const swift: any
}
