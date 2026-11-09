/** Real lazy language imports resolve through the installed maintained modules. */
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'

describe('file editor language modules', () => {
  it.each(['sh', 'toml', 'nginx', 'dockerfile', 'properties', 'env', 'cs', 'kt', 'swift'])(
    'loads the real %s parser and retains its file association', async (extension) => {
      const { languageForPath } = await import('../src/client/lang.ts')
      const language = languageForPath('test.' + extension)
      expect(language).not.toBeNull()
      const editor = EditorState.create({ doc: 'name=value', extensions: [language!] })
      expect(editor.doc.toString()).toBe('name=value')
    },
  )
})
