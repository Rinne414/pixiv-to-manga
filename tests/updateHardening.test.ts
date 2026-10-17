import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { gzipSync } from 'node:zlib'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import { applyUpdate, planReplacement, recoverInterruptedSwap } from '../bin/apply-update.mjs'
import { extractArchive, sanitizeEntryPath } from '../server/update/archive'
import { downloadText } from '../server/update/download'
import { isTrustedLocalRequest } from '../server/update/guard'
import { readInstallInfo } from '../server/update/install'
import { assertSafeForCmdRestart } from '../server/update/restart'
import { isReleaseDownloadUrl } from '../server/update/urls'
import { prepareWorkDir } from '../server/update/workdir'
import { shBundledLauncher, windowsBundledLauncher, windowsPortableLauncher } from '../scripts/pack/launchers.mjs'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ptm-harden-'))
  dirs.push(dir)
  return dir
}

function layout() {
  const base = tempDir()
  const appRoot = path.join(base, 'app')
  const staged = path.join(base, 'staged')
  for (const [root, version] of [[appRoot, 'old'], [staged, 'new']] as const) {
    mkdirSync(path.join(root, 'dist'), { recursive: true })
    mkdirSync(path.join(root, 'bin'), { recursive: true })
    writeFileSync(path.join(root, 'dist', 'index.html'), version)
    writeFileSync(path.join(root, 'bin', 'studio.mjs'), version)
    writeFileSync(path.join(root, 'package.json'), `{"version":"${version}"}`)
  }
  return { base, appRoot, staged, dataDir: path.join(base, 'data') }
}

describe('work directory (item 1)', () => {
  it('creates a fresh directory and clears leftovers from a previous run', () => {
    const dir = path.join(tempDir(), 'update-work')
    mkdirSync(dir)
    writeFileSync(path.join(dir, 'stale.bin'), 'x')
    prepareWorkDir(dir)
    expect(readdirSync(dir)).toEqual([])
  })

  it('is private to the user on POSIX', () => {
    if (process.platform === 'win32') return
    const dir = path.join(tempDir(), 'update-work')
    mkdirSync(dir, { mode: 0o777 })
    prepareWorkDir(dir)
    expect(statSync(dir).mode & 0o077).toBe(0)
  })

  it('refuses a work directory that is a link', () => {
    const base = tempDir()
    const target = path.join(base, 'elsewhere')
    mkdirSync(target)
    const link = path.join(base, 'update-work')
    symlinkSync(target, link, 'junction')
    expect(() => prepareWorkDir(link)).toThrow(/link|symlink/i)
    expect(existsSync(target)).toBe(true)
  })
})

describe('interrupted swap (item 2)', () => {
  function interrupted() {
    const { appRoot, staged, dataDir, base } = layout()
    const backup = path.join(appRoot, '.update-backup')
    mkdirSync(path.join(backup, 'dist'), { recursive: true })
    writeFileSync(path.join(backup, 'dist', 'index.html'), 'OLD-FROM-BACKUP')
    writeFileSync(
      path.join(backup, 'swap-in-progress.json'),
      JSON.stringify({ entries: [{ name: 'dist', hadOld: true }, { name: 'extra.txt', hadOld: false }] }),
    )
    // The crash left a half-copied new dist and a brand new file in the app folder.
    writeFileSync(path.join(appRoot, 'dist', 'index.html'), 'PARTIAL')
    writeFileSync(path.join(appRoot, 'extra.txt'), 'new file from the failed update')
    return { appRoot, staged, dataDir, base, backup }
  }

  it('restores the old files from the backup and removes the leftovers', () => {
    const { appRoot, backup } = interrupted()
    expect(recoverInterruptedSwap(appRoot).restored).toBe(true)
    expect(readFileSync(path.join(appRoot, 'dist', 'index.html'), 'utf8')).toBe('OLD-FROM-BACKUP')
    expect(existsSync(path.join(appRoot, 'extra.txt'))).toBe(false)
    expect(existsSync(backup)).toBe(false)
  })

  it('never deletes a backup it cannot explain', () => {
    const { appRoot } = layout()
    const backup = path.join(appRoot, '.update-backup')
    mkdirSync(path.join(backup, 'dist'), { recursive: true })
    writeFileSync(path.join(backup, 'dist', 'index.html'), 'only copy')
    expect(() => recoverInterruptedSwap(appRoot)).toThrow(/backup/i)
    expect(readFileSync(path.join(backup, 'dist', 'index.html'), 'utf8')).toBe('only copy')
  })

  it('applyUpdate restores a leftover swap before starting a new one', () => {
    const { appRoot, staged, dataDir } = interrupted()
    applyUpdate({ appRoot, stagedRoot: staged, dataDir })
    expect(readFileSync(path.join(appRoot, 'dist', 'index.html'), 'utf8')).toBe('new')
    expect(existsSync(path.join(appRoot, '.update-backup'))).toBe(false)
  })

  it('replaces bin last so the recovery code survives a crash as long as possible', () => {
    const { appRoot, staged, dataDir } = layout()
    const { replace } = planReplacement({ appRoot, stagedRoot: staged, dataDir })
    expect(replace[replace.length - 1]).toBe('bin')
  })
})

describe('data-dir protection (item 3)', () => {
  it('compares case-insensitively when asked (Windows)', () => {
    const { appRoot, staged, base } = layout()
    const dataDir = path.join(base, 'app', 'DIST', 'data')
    expect(() => planReplacement({ appRoot, stagedRoot: staged, dataDir, caseInsensitive: true })).toThrow(/data/i)
  })

  it('treats protected names case-insensitively when asked', () => {
    const { appRoot, staged, dataDir } = layout()
    mkdirSync(path.join(staged, 'OUTPUT'))
    const plan = planReplacement({ appRoot, stagedRoot: staged, dataDir, caseInsensitive: true })
    expect(plan.replace).not.toContain('OUTPUT')
  })

  it('resolves junctions and symlinks before comparing', () => {
    const { appRoot, staged, base } = layout()
    const link = path.join(base, 'innocent-looking')
    symlinkSync(path.join(appRoot, 'dist'), link, 'junction')
    expect(() => planReplacement({ appRoot, stagedRoot: staged, dataDir: path.join(link, 'data') })).toThrow(/data/i)
  })
})

describe('Windows restart quoting (item 4)', () => {
  it('refuses cmd metacharacters in the app path or launcher name', () => {
    for (const bad of ['C:\\a&b', 'C:\\a^b', 'C:\\100%', 'C:\\hi!', 'C:\\q"x']) {
      expect(() => assertSafeForCmdRestart(bad, 'start-portable.cmd', 'win32'), bad).toThrow(/folder|path/i)
    }
    expect(() => assertSafeForCmdRestart('C:\\ok', 'a&b.cmd', 'win32')).toThrow()
  })

  it('accepts ordinary paths, spaces and CJK, and never blocks other platforms', () => {
    expect(() => assertSafeForCmdRestart('C:\\My Apps\\漫畫 (v1)', 'start-portable.cmd', 'win32')).not.toThrow()
    expect(() => assertSafeForCmdRestart('/home/a&b', 'start-portable.sh', 'linux')).not.toThrow()
  })
})

describe('launchers (items 5 and Linux restart)', () => {
  it('the Windows node line also decides the exit in the same parsed line', () => {
    for (const body of [windowsBundledLauncher, windowsPortableLauncher]) {
      const lines = body.split('\r\n')
      const index = lines.findIndex((line) => line.includes('bin\\studio.mjs') && !line.startsWith('echo'))
      expect(lines[index]).toContain('exit /b')
      expect(lines.slice(index + 1).filter((line) => line.trim())).toEqual([])
    }
  })

  it('the Linux launcher applies a pending update in the same terminal and relaunches', () => {
    expect(shBundledLauncher).toContain('PTM_LAUNCHER_HANDLES_UPDATE=1')
    expect(shBundledLauncher).toContain('.update-pending')
    expect(shBundledLauncher).toContain('exec "$self"')
  })
})

describe('guard port match (item 6)', () => {
  const strict = { requireSamePort: true }
  it('requires the Origin port to equal the Host port when strict', () => {
    expect(isTrustedLocalRequest({ host: '127.0.0.1:4174', origin: 'http://127.0.0.1:5173' }, strict)).toBe(false)
    expect(isTrustedLocalRequest({ host: '127.0.0.1:4174', origin: 'http://localhost:4174' }, strict)).toBe(true)
    expect(isTrustedLocalRequest({ host: '127.0.0.1:4174' }, strict)).toBe(true)
  })
})

describe('first-hop release url (item 7)', () => {
  it('only accepts this repository release downloads', () => {
    expect(isReleaseDownloadUrl('https://github.com/Rinne414/pixiv-to-manga/releases/download/v1/a.zip')).toBe(true)
    expect(isReleaseDownloadUrl('https://github.com/evil/other/releases/download/v1/a.zip')).toBe(false)
    expect(isReleaseDownloadUrl('https://github.com/Rinne414/pixiv-to-manga/archive/main.zip')).toBe(false)
    expect(isReleaseDownloadUrl('https://objects.githubusercontent.com/Rinne414/pixiv-to-manga/releases/download/v1/a')).toBe(false)
  })
})

describe('archive limits and names (items 8 and 10)', () => {
  it('stops inflating a gzip that expands past the cap', async () => {
    const file = path.join(tempDir(), 'bomb.tar.gz')
    writeFileSync(file, gzipSync(Buffer.alloc(8 * 1024 * 1024)))
    await expect(extractArchive(file, tempDir(), { maxTotalBytes: 100_000 })).rejects.toThrow(/too large/i)
  })

  it('rejects a zip whose declared sizes exceed the cap before extracting anything', async () => {
    const zip = new JSZip()
    zip.file('pkg/a.txt', 'x'.repeat(5000))
    zip.file('pkg/b.txt', 'y'.repeat(5000))
    const file = path.join(tempDir(), 'a.zip')
    writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }))
    const dest = tempDir()
    await expect(extractArchive(file, dest, { maxTotalBytes: 6000 })).rejects.toThrow(/too large/i)
    expect(readdirSync(dest)).toEqual([])
  })

  it('rejects Windows-hostile names', () => {
    for (const name of ['pkg/a:b', 'pkg/trailing.', 'pkg/trailing ', 'pkg/C:/x', 'pkg/stream.txt:hidden']) {
      expect(() => sanitizeEntryPath(name), name).toThrow()
    }
    expect(sanitizeEntryPath('pkg/.hidden/file.txt')).toBe('pkg/.hidden/file.txt')
  })

  it('rejects entries that collide only by case', async () => {
    const zip = new JSZip()
    zip.file('pkg/Readme.md', 'a')
    zip.file('pkg/README.md', 'b')
    const file = path.join(tempDir(), 'dup.zip')
    writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }))
    await expect(extractArchive(file, tempDir())).rejects.toThrow(/duplicate|collide/i)
  })
})

describe('checksum download is bounded while streaming (item 9)', () => {
  it('aborts as soon as the body passes the limit', async () => {
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(new Uint8Array(1024))
        if (pulled > 10_000) controller.close()
      },
    })
    const fetchImpl = async () => new Response(body)
    await expect(
      downloadText('https://github.com/Rinne414/pixiv-to-manga/releases/download/v1/SHA256SUMS.txt', { fetchImpl, maxBytes: 4096 }),
    ).rejects.toThrow(/larger than allowed/)
    expect(pulled).toBeLessThan(100)
  })
})

describe('install-info robustness (item 11)', () => {
  it('treats a corrupt install-info.json as a non-packaged build', () => {
    const appRoot = tempDir()
    writeFileSync(path.join(appRoot, 'package.json'), '{"version":"0.8.0"}')
    writeFileSync(path.join(appRoot, 'install-info.json'), '{not json')
    expect(readInstallInfo(appRoot).packageType).toBeNull()
  })
})
