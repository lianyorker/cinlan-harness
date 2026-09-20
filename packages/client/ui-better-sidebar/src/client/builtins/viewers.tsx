/** Built-in previews use the public file viewer registry and its Settings enablement. */
import { IconCodeOutline16, IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { VscFileText, VscTable, VscPreview } from 'react-icons/vsc'
import { lazyChunkComponent } from '../lazy-chunk.tsx'
import { PdfView } from '../PdfView.tsx'
import { OfficePreview } from '../office/OfficePreview.tsx'
import type { ReadOfficePreview } from '../office/read-office.ts'
import { BinaryDownload } from '../binary-download.tsx'
import {
  IconImageOutline16,
  IconMarkdownOutline16,
  IconPdfOutline16,
  IconHtmlOutline16,
} from '../icons.tsx'
import type { ComponentType } from 'react'
import type { FileViewerDescriptor, FileViewerProps } from '../service.ts'
import type { MatchEditorShortcut } from '../keyboard-commands.ts'
import { t } from '../locales.ts'
import css from '../sidebar.module.css'

/**
 * Lazy wrapper over the chunk-resident viewer component. The `pick`
 * function is module-level (stable identity — the wrapper effect depends
 * on it); the cast bridges the chunk exports record to the descriptor prop
 * shape (the view reads only its own subset of FileViewerProps).
 */
const LazyTextEditor = lazyChunkComponent<FileViewerProps>('editor', mod => mod.TextEditor as ComponentType<FileViewerProps> | undefined)

/**
 * Declare previews with the same priority and enablement rules as external viewers.
 * @param matchShortcut - Keyboard matcher shared by the lazy text editors.
 * @param readOffice - Authorized Host conversion callback supplied by apply.
 * @returns File viewer descriptors, including read-only Word, Excel, and PowerPoint.
 */
export function builtinViewers(matchShortcut?: MatchEditorShortcut, readOffice?: ReadOfficePreview): readonly FileViewerDescriptor[] {
  return [
    {
      id: 'image',
      title: () => t('viewerImage'),
      icon: (size: number) => <IconImageOutline16 size={size} />,
      exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'],
      fetchStrategy: 'mediaUrl',
      component: ({ mediaUrl: url, title }) => (
        <div className={css.editorImageWrap}>
          <img className={css.editorImage} src={url} alt={title} />
        </div>
      ),
    },
    {
      id: 'pdf',
      title: () => t('viewerPdf'),
      icon: (size: number) => <IconPdfOutline16 size={size} />,
      exts: ['pdf'],
      fetchStrategy: 'mediaUrl',
      component: ({ scope, path, title }) => (
        <PdfView scope={scope} path={path} title={title} />
      ),
    },
    {
      id: 'docx',
      title: () => t('viewerWord'),
      icon: (size: number) => <VscFileText size={size} />,
      exts: ['doc', 'docx'],
      fetchStrategy: 'none',
      component: ({ scope, path, title }) => <OfficePreview read={readOffice} scope={scope} path={path} title={title} />,
    },
    {
      id: 'xlsx',
      title: () => t('viewerExcel'),
      icon: (size: number) => <VscTable size={size} />,
      exts: ['xls', 'xlsx'],
      fetchStrategy: 'none',
      component: ({ scope, path, title }) => <OfficePreview read={readOffice} scope={scope} path={path} title={title} />,
    },
    {
      id: 'pptx',
      title: () => t('viewerPowerPoint'),
      icon: (size: number) => <VscPreview size={size} />,
      exts: ['ppt', 'pptx'],
      fetchStrategy: 'none',
      component: ({ scope, path, title }) => <OfficePreview read={readOffice} scope={scope} path={path} title={title} />,
    },
    {
      id: 'markdown',
      title: () => t('viewerMarkdown'),
      icon: (size: number) => <IconMarkdownOutline16 size={size} />,
      exts: ['md', 'markdown'],
      fetchStrategy: 'fsRead',
      component: props => <LazyTextEditor {...props} matchShortcut={matchShortcut} />,
    },
    {
      id: 'html',
      title: () => t('viewerHtml'),
      icon: (size: number) => <IconHtmlOutline16 size={size} />,
      exts: ['html', 'htm'],
      fetchStrategy: 'fsRead',
      // Declarative settings: the sandbox escape hatch and the default-unsafe
      // start state render under this viewer's row in the Side card settings
      // page (both warned on).
      settings: {
        toggles: [{
          key: 'htmlViewerNoSandbox',
          title: () => t('settingsHtmlSandboxTitle'),
          desc: () => t('settingsHtmlSandboxDesc'),
        }, {
          key: 'htmlViewerDefaultUnsafe',
          title: () => t('settingsHtmlDefaultUnsafeTitle'),
          desc: () => t('settingsHtmlDefaultUnsafeDesc'),
        }],
      },
      component: props => <LazyTextEditor {...props} matchShortcut={matchShortcut} />,
    },
    {
      id: 'code',
      title: () => t('viewerCode'),
      icon: (size: number) => <IconCodeOutline16 size={size} />,
      exts: [],
      priority: -100,
      fetchStrategy: 'fsRead',
      component: props => <LazyTextEditor {...props} matchShortcut={matchShortcut} />,
    },
    {
      id: 'binary-download',
      title: () => t('viewerBinary'),
      icon: (size: number) => <IconDownloadOutline16 size={size} />,
      exts: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'],
      priority: -50,
      fetchStrategy: 'binary-download',
      // NUL probe: a file whose head bytes contain a NUL is binary — claimed
      // before the catch-all code viewer on the head re-match.
      detect: (_path, head) => head.includes(0),
      component: ({ scope, path }) => <BinaryDownload scope={scope} path={path} />,
    },
  ]
}
