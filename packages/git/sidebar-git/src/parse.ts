/** Parse the existing sidebar Git porcelain and history formats. */
import type { GitStatusEntry, GitLogEntry } from './types.ts'

/** Parse porcelain v1 -z output into entries (rename/copy pairs collapse to one row). */
export function parsePorcelainZ(output: string): GitStatusEntry[] {
  const tokens = output.split('\0')
  const entries: GitStatusEntry[] = []
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]
    index += 1
    if (token === undefined || token === '') continue
    const xy = token.slice(0, 2)
    const rest = token.slice(3)
    const entry: GitStatusEntry = { path: rest, xy }
    entries.push(entry)
    // Rename/copy entries carry the ORIGIN path as the next NUL field; the
    // new path (the file as it exists now) is the display path.
    const previousPath = tokens[index]
    if ((xy[0] === 'R' || xy[0] === 'C') && previousPath !== undefined && previousPath !== '') {
      entry.previousPath = previousPath
      index += 1
    }
  }
  return entries
}

/** Parse `git log --pretty=format:%h%x1f%s%x1f%an%x1f%ai%x1f%H%x1f%D` rows. */
export function parseLogLines(output: string): GitLogEntry[] {
  const rows: GitLogEntry[] = []
  for (const line of output.split('\n')) {
    if (line === '') continue
    const [hash, subject, author, date, hashFull, refs] = line.split('\x1f')
    if (hash === undefined || subject === undefined) continue
    rows.push({
      hash,
      subject,
      author: author ?? '',
      date: date ?? '',
      hashFull: hashFull ?? hash,
      refs: refs ?? '',
    })
  }
  return rows
}
