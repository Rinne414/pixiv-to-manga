import { chmodSync, lstatSync, mkdirSync, readdirSync, rmSync, type Stats } from 'node:fs'
import path from 'node:path'

/**
 * Creates an empty, private scratch folder for one update. It lives under the user's own data
 * directory (never a shared temp folder) and is refused if something else got there first:
 * a link or a folder owned by another user. A folder of ours with loose permissions is tightened to 0700.
 */
export function prepareWorkDir(dir: string): void {
  const existing = statOrNull(dir)
  if (existing) {
    assertOwnDirectory(dir, existing)
    for (const name of readdirSync(dir)) rmSync(path.join(dir, name), { recursive: true, force: true })
    return
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  assertOwnDirectory(dir, lstatSync(dir))
}

function statOrNull(dir: string): Stats | null {
  try {
    return lstatSync(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function assertOwnDirectory(dir: string, stat: Stats): void {
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`The update work folder (${dir}) is a link or not a folder, so it was not used.`)
  }
  if (process.platform === 'win32') return
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error(`The update work folder (${dir}) belongs to another user, so it was not used.`)
  }
  // Ours but too open (e.g. created with a loose umask): tighten it; anything inside is cleared by the caller.
  if ((stat.mode & 0o077) !== 0) chmodSync(dir, 0o700)
}
