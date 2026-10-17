#!/usr/bin/env node
// Applies a staged update after the studio has exited. The server copies this file to a
// temp folder and runs it with the *staged* Node runtime, so nothing here touches a file
// the old process still holds open (Windows cannot overwrite a running node.exe).
//
// Plain ESM with node: builtins only: it must run standalone, and tests import it directly.
import { spawn } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** Top-level names an update must never replace, even if an archive ships them. */
export const PROTECTED_ENTRIES = new Set(['output', '.ptm-data', '.update-backup'])

const BACKUP_DIR = '.update-backup'
const RETRIES = 20
const RETRY_DELAY_MS = 250

export function planReplacement({ appRoot, stagedRoot, dataDir }) {
  const replace = readdirSync(stagedRoot).filter((name) => !PROTECTED_ENTRIES.has(name))
  const data = path.resolve(dataDir)
  for (const name of replace) {
    const target = path.resolve(appRoot, name)
    if (data === target || data.startsWith(target + path.sep)) {
      throw new Error(
        `Your data folder (${data}) is inside "${name}", which the update would replace. Move the data folder out of the app folder and try again.`,
      )
    }
  }
  return { replace }
}

/**
 * Moves each old top-level entry into a backup folder, copies the staged one in, and restores
 * the backup if anything fails. Entries the archive does not contain are left alone.
 * `failAfterEntries` exists so tests can exercise the rollback path.
 */
export function applyUpdate({ appRoot, stagedRoot, dataDir, failAfterEntries }) {
  const { replace } = planReplacement({ appRoot, stagedRoot, dataDir })
  const backupRoot = path.join(appRoot, BACKUP_DIR)
  rmSync(backupRoot, { recursive: true, force: true })
  mkdirSync(backupRoot, { recursive: true })

  const touched = []
  try {
    for (const name of replace) {
      const target = path.join(appRoot, name)
      const backup = path.join(backupRoot, name)
      const hadOld = existsSync(target)
      if (hadOld) withRetry(() => renameSync(target, backup))
      touched.push({ name, hadOld })
      if (failAfterEntries !== undefined && touched.length > failAfterEntries) {
        throw new Error('Simulated failure while copying update files')
      }
      cpSync(path.join(stagedRoot, name), target, { recursive: true, force: true })
    }
  } catch (error) {
    rollback(appRoot, backupRoot, touched)
    throw error
  }
  rmSync(backupRoot, { recursive: true, force: true })
}

function rollback(appRoot, backupRoot, touched) {
  for (const { name, hadOld } of [...touched].reverse()) {
    const target = path.join(appRoot, name)
    rmSync(target, { recursive: true, force: true })
    if (hadOld) withRetry(() => renameSync(path.join(backupRoot, name), target))
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
  restart(job)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2])
}
