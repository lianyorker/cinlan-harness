/**
 * The built-in catalog of FILE-PREVIEWER plugins (file-type previewers),
 * shown in the Files settings "add preview plugin" dialog.
 * Adding an entry: append one object here (unique
 * `id` = npm package name, `url` = GitHub repo, `description` =
 * i18n-friendly, `install` = the full shell command pre-filled into the
 * install terminal — it starts with `cd ~/.dsh` so the install runs with
 * the DSH home as the working directory). Data integrity is guarded by
 * `tests/plugin-list.spec.ts`.
 */
import { t } from './locales.ts'
import type { PluginEntry } from './plugins-shared.ts'

/** File-previewer plugins (alphabetical order). */
export const builtinViewerPlugins: readonly PluginEntry[] = [
  {
    id: 'dsh-video-preview',
    name: '视频预览插件',
    url: 'https://github.com/zemul/dsh-video-preview',
    description: () => t('pluginVideoPreviewDesc'),
    install: 'cd ~/.dsh && dsh plugin --profile web add dsh-video-preview',
  },
]
