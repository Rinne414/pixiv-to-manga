import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { isTrustedLocalRequest } from '../server/update/guard'
import {
  AUTO_CHECK_INTERVAL_MS,
  getUpdateSettings,
  setAutoCheck,
  shouldAutoCheck,
  type SettingsStore,
} from '../server/update/settings'
import { applyUpdate, planReplacement } from '../bin/apply-update.mjs'

function memoryStore(): SettingsStore {
  const map = new Map<string, string>()
  return {
    getSetting: (key, fallback = '') => map.get(key) ?? fallback,
    upsertSetting: (key, value) => void map.set(key, value),
  }
}

describe('update settings', () => {
  it('defaults to automatic checking and persists the toggle', () => {
    const store = memoryStore()
    expect(getUpdateSettings(store).autoCheck).toBe(true)
    setAutoCheck(store, false)
    expect(getUpdateSettings(store).autoCheck).toBe(false)
    setAutoCheck(store, true)
    expect(getUpdateSettings(store).autoCheck).toBe(true)
  })

  it('auto-checks at most once every six hours and only when enabled', () => {
    const now = Date.parse('2026-10-17T12:00:00Z')
    const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString()
    expect(AUTO_CHECK_INTERVAL_MS).toBe(6 * 3600_000)
    expect(shouldAutoCheck({ autoCheck: true, lastCheckedAt: null }, now)).toBe(true)
    expect(shouldAutoCheck({ autoCheck: true, lastCheckedAt: hoursAgo(7) }, now)).toBe(true)
    expect(shouldAutoCheck({ autoCheck: true, lastCheckedAt: hoursAgo(5) }, now)).toBe(false)
    expect(shouldAutoCheck({ autoCheck: false, lastCheckedAt: null }, now)).toBe(false)
    expect(shouldAutoCheck({ autoCheck: true, lastCheckedAt: 'garbage' }, now)).toBe(true)
  })
})

describe('isTrustedLocalRequest', () => {
  it('accepts same-machine browser requests', () => {
    expect(isTrustedLocalRequest({ host: '127.0.0.1:4174' })).toBe(true)
    expect(isTrustedLocalRequest({ host: 'localhost:4174', origin: 'http://localhost:4174' })).toBe(true)
    expect(isTrustedLocalRequest({ host: '127.0.0.1:4174', origin: 'http://127.0.0.1:5173', 'sec-fetch-site': 'same-site' })).toBe(true)
    expect(isTrustedLocalRequest({ host: '[::1]:4174', 'sec-fetch-site': 'same-origin' })).toBe(true)
  })

  it('rejects DNS rebinding, foreign origins, and cross-site fetches', () => {
    expect(isTrustedLocalRequest({ host: 'evil.example:4174' })).toBe(false)
    expect(isTrustedLocalRequest({})).toBe(false)
    expect(isTrustedLocalRequest({ host: '127.0.0.1:4174', origin: 'https://evil.example' })).toBe(false)
    expect(isTrustedLocalRequest({ host: '127.0.0.1:4174', origin: 'http://127.0.0.1.evil.example' })).toBe(false)
    expect(isTrustedLocalRequest({ host: '127.0.0.1:4174', origin: 'null' })).toBe(false)
    expect(isTrustedLocalRequest({ host: '127.0.0.1:4174', 'sec-fetch-site': 'cross-site' })).toBe(false)
  })
})

describe('update replacement keeps user data', () => {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
  })

  function layout() {
    const base = mkdtempSync(path.join(os.tmpdir(), 'ptm-apply-'))
    dirs.push(base)
    const appRoot = path.join(base, 'app')
    const staged = path.join(base, 'staged')
    for (const [root, version] of [[appRoot, 'old'], [staged, 'new']] as const) {
      mkdirSync(path.join(root, 'dist'), { recursive: true })
      writeFileSync(path.join(root, 'dist', 'index.html'), version)
      writeFileSync(path.join(root, 'package.json'), `{"version":"${version}"}`)
    }
    writeFileSync(path.join(staged, 'extra.txt'), 'only in new')
    return { base, appRoot, staged }
  }

  it('swaps app files, leaves unrelated files alone, and keeps no backup behind', () => {
    const { appRoot, staged } = layout()
    mkdirSync(path.join(appRoot, 'output'))
    writeFileSync(path.join(appRoot, 'output', 'mine.png'), 'user')
    writeFileSync(path.join(appRoot, 'notes.txt'), 'user notes')
    applyUpdate({ appRoot, stagedRoot: staged, dataDir: path.join(appRoot, '..', 'data') })
    expect(readFileSync(path.join(appRoot, 'dist', 'index.html'), 'utf8')).toBe('new')
    expect(readFileSync(path.join(appRoot, 'extra.txt'), 'utf8')).toBe('only in new')
    expect(readFileSync(path.join(appRoot, 'output', 'mine.png'), 'utf8')).toBe('user')
    expect(readFileSync(path.join(appRoot, 'notes.txt'), 'utf8')).toBe('user notes')
  })

  it('never replaces output/ even if the archive ships one', () => {
    const { appRoot, staged } = layout()
    mkdirSync(path.join(appRoot, 'output'))
    writeFileSync(path.join(appRoot, 'output', 'mine.png'), 'user')
    mkdirSync(path.join(staged, 'output'))
    writeFileSync(path.join(staged, 'output', 'from-archive.png'), 'x')
    expect(planReplacement({ appRoot, stagedRoot: staged, dataDir: '/nowhere' }).replace).not.toContain('output')
    applyUpdate({ appRoot, stagedRoot: staged, dataDir: path.join(appRoot, '..', 'data') })
    expect(readFileSync(path.join(appRoot, 'output', 'mine.png'), 'utf8')).toBe('user')
  })

  it('refuses when the data directory lives inside a folder it would replace', () => {
    const { appRoot, staged } = layout()
    const dataDir = path.join(appRoot, 'dist', 'data')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(path.join(dataDir, 'studio.sqlite'), 'db')
    expect(() => applyUpdate({ appRoot, stagedRoot: staged, dataDir })).toThrow(/data/i)
    expect(readFileSync(path.join(dataDir, 'studio.sqlite'), 'utf8')).toBe('db')
    expect(readFileSync(path.join(appRoot, 'dist', 'index.html'), 'utf8')).toBe('old')
  })

  it('rolls back to the old files when a copy fails midway', () => {
    const { appRoot, staged } = layout()
    const result = () =>
      applyUpdate({ appRoot, stagedRoot: staged, dataDir: path.join(appRoot, '..', 'data'), failAfterEntries: 1 })
    expect(result).toThrow()
    expect(readFileSync(path.join(appRoot, 'dist', 'index.html'), 'utf8')).toBe('old')
    expect(readFileSync(path.join(appRoot, 'package.json'), 'utf8')).toContain('old')
  })
})
