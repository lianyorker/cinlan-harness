import { describe, expect, it } from 'vitest'
import { parseLogLines, parsePorcelainZ } from '../src/parse.ts'

describe('sidebar Git parsing', () => {
  it('parses porcelain -z entries including renames', () => {
    const output = ['M  src/a.ts', ' M src/b.ts', '?? src/c.ts', 'R  src/new.ts', 'src/old.ts', ''].join('\0')
    const entries = parsePorcelainZ(output)
    expect(entries).toEqual([
      { path: 'src/a.ts', xy: 'M ' },
      { path: 'src/b.ts', xy: ' M' },
      { path: 'src/c.ts', xy: '??' },
      { path: 'src/new.ts', xy: 'R ', previousPath: 'src/old.ts' },
    ])
  })

  it('keeps untracked files inside new directories as individual rows (status --untracked-files=all)', () => {
    // status() runs with --untracked-files=all, so a new folder must surface
    // as one entry PER FILE (?? newdir/a.ts), never a collapsed ?? newdir/
    // row that has no diff and cannot be read (regression: new folders showed
    // as a single folder row whose diff tab failed with "is a directory").
    const output = ['?? newdir/a.ts', '?? newdir/sub/b.ts', ''].join('\0')
    expect(parsePorcelainZ(output)).toEqual([
      { path: 'newdir/a.ts', xy: '??' },
      { path: 'newdir/sub/b.ts', xy: '??' },
    ])
  })

  it('parses log rows with unit separators (full hash + refs)', () => {
    const rows = parseLogLines(
      'abc1234\x1fFirst subject\x1fAlice\x1f2024-01-01 10:00:00 +0800\x1fabc1234def5678abc1234def5678abc1234def5678\x1fHEAD -> main, origin/main\n'
      + 'def5678\x1fSecond subject\x1fBob\x1f2024-01-02 10:00:00 +0800\x1fdef5678abc1234def5678abc1234def5678abc1234\x1f\n',
    )
    expect(rows).toEqual([
      {
        hash: 'abc1234',
        subject: 'First subject',
        author: 'Alice',
        date: '2024-01-01 10:00:00 +0800',
        hashFull: 'abc1234def5678abc1234def5678abc1234def5678',
        refs: 'HEAD -> main, origin/main',
      },
      {
        hash: 'def5678',
        subject: 'Second subject',
        author: 'Bob',
        date: '2024-01-02 10:00:00 +0800',
        hashFull: 'def5678abc1234def5678abc1234def5678abc1234',
        refs: '',
      },
    ])
  })

})
