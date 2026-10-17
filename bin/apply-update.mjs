#!/usr/bin/env node
// Applies a staged update after the studio has exited. The server copies this file to a
// private folder and runs it with the *staged* Node runtime, so nothing here touches a file
// the old process still holds open (Windows cannot overwrite a running node.exe).
//
// Plain ESM with node: builtins only: it must run standalone, and tests import it directly.
// bin/studio.mjs also imports recoverInterruptedSwap() so a swap cut short by a crash or power
// loss is rolled back on the next start.
import { spawn } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Top-level names an update must never replace, even if an archive ships them. */
export const PROTECTED_ENTRIES = new Set(['output', '.ptm-data', '.update-backup', '.update-pending'])

const BACKUP_DIR = '.update-backup'
const MARKER_FILE = 'swap-in-progress.json'
const RETRIES = 20
const RETRY_DELAY_MS = 250
/** Replaced last: it holds this recovery code, which must survive as long as possible. */
const LAST_ENTRY = 'bin'

const defaultCaseInsensitive = () => process.platform === 'win32' || process.platform === 'darwin'

/** Resolves links/junctions of the deepest existing ancestor, then appends the missing tail. */
function canonical(target, caseInsensitive) {
  let existing = path.resolve(target)
  const tail = []
  while (!existsSync(existing)) {
    const parent = path.dirname(existing)
    if (parent === existing) break
    tail.unshift(path.basename(existing))
    existing = parent
  }
  const resolved = path.join(realpathSync.native(existing), ...tail)
  return caseInsensitive ? resolved.toLowerCase() : resolved
}

export function planReplacement({ appRoot, stagedRoot, dataDir, caseInsensitive = defaultCaseInsensitive() }) {
  const fold = (name) => (caseInsensitive ? name.toLowerCase() : name)
  const protectedNames = new Set([...PROTECTED_ENTRIES].map(fold))
  const replace = readdirSync(stagedRoot)
    .filter((name) => !protectedNames.has(fold(name)))
    .sort((a, b) => Number(a === LAST_ENTRY) - Number(b === LAST_ENTRY))
  const data = canonical(dataDir, caseInsensitive)
  const root = canonical(appRoot, caseInsensitive)
  for (const name of replace) {
    const target = path.join(root, fold(name))
    if (data === target || data.startsWith(target + path.sep)) {
      throw new Error(
        `Your data folder (${dataDir}) is inside "${name}", which the update would replace. Move the data folder out of the app folder and try again.`,
      )
    }
  }
  return { replace }
}

/**
 * Rolls back a swap that never finished. The backup folder is the only copy of the old version,
 * so it is never deleted unless the marker proves what it holds.
 */
export function recoverInterruptedSwap(appRoot) {
  const backupRoot = path.join(appRoot, BACKUP_DIR)
  if (!existsSync(backupRoot)) return { restored: false }
  const markerPath = path.join(backupRoot, MARKER_FILE)
  if (!existsSync(markerPath)) {
    if (readdirSync(backupRoot).length === 0) {
      rmSync(backupRoot, { recursive: true, force: true })
      return { restored: false }
    }
    throw new Error(
      `An earlier update left files in ${backupRoot} that cannot be matched to a swap. They were kept; copy them back by hand or delete the folder if you are sure.`,
    )
  }
  const { entries } = JSON.parse(readFileSync(markerPath, 'utf8'))
  for (const { name, hadOld } of entries) {
    const target = path.join(appRoot, name)
    const saved = path.join(backupRoot, name)
    if (existsSync(saved)) {
      rmSync(target, { recursive: true, force: true })
      withRetry(() => renameSync(saved, target))
    } else if (!hadOld) {
      rmSync(target, { recursive: true, force: true })
    }
  }
  rmSync(backupRoot, { recursive: true, force: true })
  return { restored: true }
}

/**
 * Moves each old top-level entry into a backup folder, copies the staged one in, and restores
 * the backup if anything fails. Entries the archive does not contain are left alone.
 * `failAfterEntries` exists so tests can exercise the rollback path.
 */
export function applyUpdate({ appRoot, stagedRoot, dataDir, failAfterEntries, caseInsensitive }) {
  recoverInterruptedSwap(appRoot)
  const { replace } = planReplacement({ appRoot, stagedRoot, dataDir, caseInsensitive })
  const backupRoot = path.join(appRoot, BACKUP_DIR)
  mkdirSync(backupRoot, { recursive: true })
  const entries = replace.map((name) => ({ name, hadOld: existsSync(path.join(appRoot, name)) }))
  const markerPath = path.join(backupRoot, MARKER_FILE)
  writeFileSync(`${markerPath}.tmp`, JSON.stringify({ entries }))
  renameSync(`${markerPath}.tmp`, markerPath)

  let done = 0
  try {
    for (const { name, hadOld } of entries) {
      const target = path.join(appRoot, name)
      if (hadOld) withRetry(() => renameSync(target, path.join(backupRoot, name)))
      done += 1
      if (failAfterEntries !== undefined && done > failAfterEntries) {
        throw new Error('Simulated failure while copying update files')
      }
      cpSync(path.join(stagedRoot, name), target, { recursive: true, force: true })
    }
  } catch (error) {
    recoverInterruptedSwap(appRoot)
    throw error
  }
  rmSync(backupRoot, { recursive: true, force: true })
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function withRetry(action) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return action()
    } catch (error) {
      const busy = error && (error.code === 'EBUSY' || error.code === 'EPERM' || error.code === 'EACCES')
      if (!busy || attempt >= RETRIES) throw error
      sleep(RETRY_DELAY_MS)
    }
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function waitForExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (isRunning(pid)) {
    if (Date.now() > deadline) throw new Error('The studio did not close in time, so the update was not applied.')
    sleep(200)
  }
}

function restart(job) {
  const env = { ...process.env, PTM_OPEN_BROWSER: '0' }
  if (process.platform === 'win32') {
    spawn('cmd.exe', ['/c', 'start', 'Pixiv-to-Manga Studio', '/D', job.appRoot, job.launcher], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env,
    }).unref()
    return
  }
  spawn('sh', [path.join(job.appRoot, job.launcher)], { cwd: job.appRoot, detached: true, stdio: 'ignore', env }).unref()
}

function writeResult(job, result) {
  try {
    mkdirSync(job.dataDir, { recursive: true })
    writeFileSync(path.join(job.dataDir, 'update-result.json'), JSON.stringify({ ...result, at: new Date().toISOString() }))
  } catch {
    // The result file is a courtesy for the UI; a failure here must not block the restart.
  }
}

function main(jobFile) {
  const job = JSON.parse(readFileSync(jobFile, 'utf8'))
  try {
    waitForExit(job.pid, 60_000)
    applyUpdate(job)
    writeResult(job, { ok: true, version: job.version })
  } catch (error) {
    writeResult(job, { ok: false, version: job.version, error: error instanceof Error ? error.message : String(error) })
  }
  // With `foreground` the launcher script restarts the studio itself, in the user's own terminal.
  if (!job.foreground) restart(job)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2])
}
