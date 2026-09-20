// @vitest-environment jsdom
/** Active delivery surfaces render filename-specific artwork with current card styling. */
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ProducedFiles } from '../src/client/ProducedFiles.tsx'
import { PresentedFileCard } from '../src/client/PresentedFileCard.tsx'
import { ChangedFiles } from '../src/client/ChangedFiles.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

it('renders filename and code icons in produced, delivered, and changed files', async () => {
  const t = makeTranslate(en)
  const { container } = render(<>
    <ProducedFiles matched={['package.json', 'src/App.tsx', 'report.pdf']} openFile={() => {}} t={t} />
    <PresentedFileCard file={{ path: 'Dockerfile', seq: 4, index: 0 }} cwd="/work" phase={undefined}
      host={{ name: 'desktop', available: true, fileManager: 'finder' }} onPreview={() => {}} onAction={() => {}} t={t} />
    <ChangedFiles changes={{ seq: 6, total: 2, added: 3, deleted: 1, files: [
      { path: '.gitignore', display: '.gitignore', added: 1, deleted: 0 },
      { path: 'src/main.py', display: 'src/main.py', added: 2, deleted: 1 },
    ] }} cwd="/work" openReview={() => {}} t={t} />
  </>)
  await expect(container.innerHTML).toMatchFileSnapshot('./expected/deliverable-file-icons.html')
})
