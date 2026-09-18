/** Lifetime SQLite writer exclusion, separate from the automation data database. */
import { open, mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Only SQLite's BUSY family proves contention; other failures retain their cause. */
function isBusy(error: unknown): boolean {
  return error instanceof Error && 'errcode' in error && typeof error.errcode === 'number' && (error.errcode & 0xff) === 5
}

/** Open a private database file without replacing an existing inode.
 * @param path - absolute path in a private directory.
 * @returns resolution after any newly created file handle closes.
 */
export async function ensurePrivateDatabase(path: string): Promise<void> {
  try { await (await open(path, 'wx', 0o600)).close() } catch (error: unknown) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  }
}

/** The one owner that may recover or dispatch a profile's automations. */
export class AutomationOwnership {
  private closed = false
  private constructor(private readonly database: DatabaseSync) {}

  /** Acquire a lifetime writer transaction. A contending process receives null.
   * @param directory - stable Harness-home automation profile directory, never an install directory.
   * @returns the owned lock, or null while another SQLite writer owns it.
   */
  static async acquire(directory: string): Promise<AutomationOwnership | null> {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(await realpath(directory), 'owner.sqlite3')
    await ensurePrivateDatabase(path)
    const database = new DatabaseSync(path)
    try {
      database.exec('PRAGMA busy_timeout = 0')
      database.exec('BEGIN IMMEDIATE')
      return new AutomationOwnership(database)
    } catch (error: unknown) {
      database.close()
      if (isBusy(error)) return null
      throw error
    }
  }

  /** Release only after admission and all owned work have drained. The file remains in place. */
  close(): void {
    if (this.closed) return
    this.closed = true
    try { this.database.exec('ROLLBACK') } finally { this.database.close() }
  }
}
