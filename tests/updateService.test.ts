import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TarArchive } from 'archiver'
import fastify from 'fastify'
import JSZip from 'jszip'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PackageType } from '../server/update/assets'
import { registerUpdateRoutes } from '../server/update/routes'
import { UpdateManager, UPDATE_EXIT_CODE, type UpdateManagerOptions, type UpdateStatus } from '../server/update/service'
import type { SettingsStore } from '../server/update/settings'

const PACKAGE = 'pixiv-to-manga-0.8.0-win-x64.zip'
const GOOD_URL = `https://github.com/Rinne414/pixiv-to-manga/releases/download/v0.8.0/${PACKAGE}`
const LINUX_PACKAGE = 'pixiv-to-manga-0.8.0-linux-x64.tar.gz'
const LINUX_URL = `https://github.com/Rinne414/pixiv-to-manga/releases/download/v0.8.0/${LINUX_PACKAGE}`
const dirs: string[] = []

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ptm-service-'))
  dirs.push(dir)
  return dir
}

function memoryStore(): SettingsStore {
  const map = new Map<string, string>()
  return {
    getSetting: (key, fallback = '') => map.get(key) ?? fallback,
    upsertSetting: (key, value) => void map.set(key, value),
  }
}

async function packageZip(version = '0.8.0'): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('pkg/package.json', JSON.stringify({ version }))
  zip.file('pkg/dist-server/index.mjs', '// server')
  zip.file('pkg/runtime/node.exe', 'fake node')
  return zip.generateAsync({ type: 'nodebuffer' })
}

async function linuxPackageTarGz(version = '0.8.0'): Promise<Buffer> {
  const archive = new TarArchive({ gzip: true })
  const chunks: Buffer[] = []
  archive.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<void>((resolve, reject) => {
    archive.on('end', resolve)
    archive.on('error', reject)
  })
  archive.append(JSON.stringify({ version }), { name: 'pkg/package.json' })
  archive.append('// server', { name: 'pkg/dist-server/index.mjs' })
  archive.append('fake node', { name: 'pkg/runtime/node', mode: 0o755 })
  await archive.finalize()
  await done
  return Buffer.concat(chunks)
}

const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')

function releaseJson(archive: Buffer, extras: { digest?: string | null; url?: string } = {}) {
  return {
    tag_name: 'v0.8.0',
    html_url: 'https://github.com/Rinne414/pixiv-to-manga/releases/tag/v0.8.0',
    body: '## v0.8.0\n\n**New** one-click update.',
    published_at: '2026-10-17T00:00:00Z',
    assets: [
      {
        name: PACKAGE,
        size: archive.length,
        browser_download_url: extras.url ?? GOOD_URL,
        digest: extras.digest === undefined ? `sha256:${sha(archive)}` : extras.digest,
      },
    ],
  }
}

function fakeFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: string) => {
    const handler = routes[input]
    if (!handler) throw new Error(`unexpected fetch ${input}`)
    return handler()
  })
}

function setup(overrides: Partial<UpdateManagerOptions> = {}, packageType: PackageType = 'win-x64') {
  const appRoot = tempDir()
  mkdirSync(path.join(appRoot, 'bin'))
  writeFileSync(path.join(appRoot, 'bin', 'apply-update.mjs'), '// helper')
  const dataDir = tempDir()
  writeFileSync(path.join(dataDir, 'studio.sqlite'), 'precious')
  const launchHelper = vi.fn(async () => undefined)
  const exit = vi.fn()
  const manager = new UpdateManager({
    settings: memoryStore(),
    install: {
      appRoot,
      currentVersion: '0.7.0',
      packageType,
      launcher: packageType === 'win-x64' ? 'start-portable.cmd' : 'start-portable.sh',
    },
    dataDir,
    workDir: path.join(tempDir(), 'work'),
    launchHelper,
    exit,
    ...overrides,
  })
  return { manager, appRoot, dataDir, launchHelper, exit }
}

async function untilIdleOrError(manager: UpdateManager): Promise<UpdateStatus> {
  for (let i = 0; i < 200; i += 1) {
    const status = manager.status()
    if (status.phase === 'idle' || status.phase === 'error' || status.phase === 'restarting') return status
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('install did not settle')
}

describe('check for updates', () => {
  it('reports a newer release with a package for this platform', async () => {
    const archive = await packageZip()
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/Rinne414/pixiv-to-manga/releases/latest': () => Response.json(releaseJson(archive)),
    })
    const { manager } = setup({ fetchImpl })
    const status = await manager.check()
    expect(status.latest).toMatchObject({ version: '0.8.0', available: true, hasPackage: true, assetName: PACKAGE })
    expect(status.latest?.notesSummary).toContain('one-click update')
    expect(status.settings.lastCheckedAt).not.toBeNull()
  })

  it('reports no update when already current', async () => {
    const archive = await packageZip()
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/Rinne414/pixiv-to-manga/releases/latest': () => Response.json(releaseJson(archive)),
    })
    const { manager } = setup({
      fetchImpl,
      install: { appRoot: tempDir(), currentVersion: '0.8.0', packageType: 'win-x64', launcher: 'x' },
    })
    expect((await manager.check()).latest?.available).toBe(false)
  })

  it('surfaces a GitHub failure and stays usable', async () => {
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/Rinne414/pixiv-to-manga/releases/latest': () => new Response('nope', { status: 503 }),
    })
    const { manager } = setup({ fetchImpl })
    await expect(manager.check()).rejects.toThrow(/503/)
    expect(manager.status().phase).toBe('error')
  })

  it('skips the automatic check when the user turned it off', async () => {
    const fetchImpl = fakeFetch({})
    const { manager } = setup({ fetchImpl })
    manager.setAutoCheck(false)
    await manager.autoCheckOnStart()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('install', () => {
  it('downloads, verifies, extracts, hands off to the helper, and never touches the data dir', async () => {
    const archive = await packageZip()
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/Rinne414/pixiv-to-manga/releases/latest': () => Response.json(releaseJson(archive)),
      [GOOD_URL]: () => new Response(new Uint8Array(archive)),
    })
    const { manager, dataDir, launchHelper, exit } = setup({ fetchImpl })
    await manager.check()
    manager.startInstall()
    expect((await untilIdleOrError(manager)).phase).toBe('restarting')
    expect(launchHelper).toHaveBeenCalledTimes(1)
    const [command, args] = launchHelper.mock.calls[0] as unknown as [string, string[]]
    expect(command.endsWith('node.exe')).toBe(true)
    const job = JSON.parse(readFileSync(args[1], 'utf8'))
    expect(job).toMatchObject({ version: '0.8.0', dataDir, launcher: 'start-portable.cmd' })
    expect(existsSync(path.join(job.stagedRoot, 'dist-server', 'index.mjs'))).toBe(true)
    expect(readFileSync(path.join(dataDir, 'studio.sqlite'), 'utf8')).toBe('precious')
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(UPDATE_EXIT_CODE))
  })

  it('runs the helper on the runtime inside the package it installs, whatever system runs the tests', async () => {
    const archive = await linuxPackageTarGz()
    const release = releaseJson(archive, { url: LINUX_URL })
    release.assets[0].name = LINUX_PACKAGE
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/Rinne414/pixiv-to-manga/releases/latest': () => Response.json(release),
      [LINUX_URL]: () => new Response(new Uint8Array(archive)),
    })
    const { manager, launchHelper } = setup({ fetchImpl }, 'linux-x64')
    await manager.check()
    manager.startInstall()
    expect((await untilIdleOrError(manager)).phase).toBe('restarting')
    const [command, args] = launchHelper.mock.calls[0] as unknown as [string, string[]]
    const job = JSON.parse(readFileSync(args[1], 'utf8'))
    expect(command).toBe(path.join(job.stagedRoot, 'runtime', 'node'))
  })

  it('refuses a download whose SHA256 does not match and never starts the helper', async () => {
    const archive = await packageZip()
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/Rinne414/pixiv-to-manga/releases/latest': () =>
        Response.json(releaseJson(archive, { digest: `sha256:${'0'.repeat(64)}` })),
      [GOOD_URL]: () => new Response(new Uint8Array(archive)),
    })
    const { manager, launchHelper } = setup({ fetchImpl })
    await manager.check()
    manager.startInstall()
    const status = await untilIdleOrError(manager)
    expect(status.phase).toBe('error')
    expect(status.error).toMatch(/SHA256/)
    expect(launchHelper).not.toHaveBeenCalled()
  })

  it('falls back to SHA256SUMS.txt when the API has no digest', async () => {
    const archive = await packageZip()
    const release = releaseJson(archive, { digest: null })
    release.assets.push({
      name: 'SHA256SUMS.txt',
      size: 100,
      browser_download_url: 'https://github.com/Rinne414/pixiv-to-manga/releases/download/v0.8.0/SHA256SUMS.txt',
      digest: null,
    })
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/Rinne414/pixiv-to-manga/releases/latest': () => Response.json(release),
      [GOOD_URL]: () => new Response(new Uint8Array(archive)),
      'https://github.com/Rinne414/pixiv-to-manga/releases/download/v0.8.0/SHA256SUMS.txt': () =>
        new Response(`${sha(archive)}  ${PACKAGE}\n`),
    })
    const { manager, launchHelper } = setup({ fetchImpl })
    await manager.check()
    manager.startInstall()
    expect((await untilIdleOrError(manager)).phase).toBe('restarting')
    expect(launchHelper).toHaveBeenCalledTimes(1)
  })

  it('refuses a package with no checksum at all', async () => {
    const archive = await packageZip()
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/Rinne414/pixiv-to-manga/releases/latest': () => Response.json(releaseJson(archive, { digest: null })),
      [GOOD_URL]: () => new Response(new Uint8Array(archive)),
    })
    const { manager, launchHelper } = setup({ fetchImpl })
    await manager.check()
    manager.startInstall()
    const status = await untilIdleOrError(manager)
    expect(status.error).toMatch(/checksum/i)
    expect(launchHelper).not.toHaveBeenCalled()
  })

  it('refuses a redirect to a host outside GitHub', async () => {
    const archive = await packageZip()
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/Rinne414/pixiv-to-manga/releases/latest': () => Response.json(releaseJson(archive)),
      [GOOD_URL]: () => new Response(null, { status: 302, headers: { location: 'https://evil.example/payload.zip' } }),
    })
    const { manager, launchHelper } = setup({ fetchImpl })
    await manager.check()
    manager.startInstall()
    const status = await untilIdleOrError(manager)
    expect(status.phase).toBe('error')
    expect(status.error).toMatch(/refusing/i)
    expect(launchHelper).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalledWith('https://evil.example/payload.zip', expect.anything())
  })

  it('refuses a package whose inner version differs from the release', async () => {
    const archive = await packageZip('0.9.9')
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/Rinne414/pixiv-to-manga/releases/latest': () => Response.json(releaseJson(archive)),
      [GOOD_URL]: () => new Response(new Uint8Array(archive)),
    })
    const { manager, launchHelper } = setup({ fetchImpl })
    await manager.check()
    manager.startInstall()
    expect((await untilIdleOrError(manager)).error).toMatch(/0\.9\.9/)
    expect(launchHelper).not.toHaveBeenCalled()
  })

  it('does not offer install for a source or npm copy', async () => {
    const archive = await packageZip()
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/Rinne414/pixiv-to-manga/releases/latest': () => Response.json(releaseJson(archive)),
    })
    const { manager } = setup({
      fetchImpl,
      install: { appRoot: tempDir(), currentVersion: '0.7.0', packageType: null, launcher: 'x' },
    })
    await manager.check()
    expect(manager.status().canInstall).toBe(false)
    expect(() => manager.startInstall()).toThrow(/git pull/)
  })
})

describe('install hardening', () => {
  it('refuses an asset url that is not this repository release download', async () => {
    const archive = await packageZip()
    const evil = 'https://github.com/evil/other/releases/download/v0.8.0/' + PACKAGE
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/Rinne414/pixiv-to-manga/releases/latest': () => Response.json(releaseJson(archive, { url: evil })),
      [evil]: () => new Response(new Uint8Array(archive)),
    })
    const { manager, launchHelper } = setup({ fetchImpl })
    await manager.check()
    manager.startInstall()
    const status = await untilIdleOrError(manager)
    expect(status.phase).toBe('error')
    expect(launchHelper).not.toHaveBeenCalled()
  })

  it('lets the launcher apply the update (no detached helper) and leaves a pending file', async () => {
    const archive = await packageZip()
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/Rinne414/pixiv-to-manga/releases/latest': () => Response.json(releaseJson(archive)),
      [GOOD_URL]: () => new Response(new Uint8Array(archive)),
    })
    const { manager, appRoot, launchHelper, exit } = setup({ fetchImpl, launcherHandlesUpdate: true })
    await manager.check()
    manager.startInstall()
    expect((await untilIdleOrError(manager)).phase).toBe('restarting')
    expect(launchHelper).not.toHaveBeenCalled()
    const lines = readFileSync(path.join(appRoot, '.update-pending'), 'utf8').trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1].endsWith('apply-update.mjs')).toBe(true)
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(UPDATE_EXIT_CODE))
  })

  it('refuses early when the app path would break the Windows restart', async () => {
    const archive = await packageZip()
    const fetchImpl = fakeFetch({
      'https://api.github.com/repos/Rinne414/pixiv-to-manga/releases/latest': () => Response.json(releaseJson(archive)),
    })
    const { manager } = setup({
      fetchImpl,
      platform: 'win32',
      install: { appRoot: 'C:\\a&b', currentVersion: '0.7.0', packageType: 'win-x64', launcher: 'start-portable.cmd' },
    })
    await manager.check()
    expect(() => manager.startInstall()).toThrow(/folder|path/i)
  })
})

describe('update routes', () => {
  async function app() {
    const { manager } = setup({ fetchImpl: fakeFetch({}) })
    const server = fastify()
    registerUpdateRoutes(server, { updates: manager })
    await server.ready()
    return server
  }

  it('answers local requests', async () => {
    const server = await app()
    const response = await server.inject({ method: 'GET', url: '/api/update/status', headers: { host: '127.0.0.1:4174' } })
    expect(response.statusCode).toBe(200)
    expect(response.json().settings.autoCheck).toBe(true)
  })

  it('rejects cross-site and rebinding requests on every update endpoint', async () => {
    const server = await app()
    const attempts = [
      { method: 'POST', url: '/api/update/install', headers: { host: '127.0.0.1:4174', origin: 'https://evil.example' } },
      { method: 'POST', url: '/api/update/check', headers: { host: '127.0.0.1:4174', 'sec-fetch-site': 'cross-site' } },
      { method: 'PUT', url: '/api/update/settings', headers: { host: 'attacker.example', 'content-type': 'application/json' }, payload: '{"autoCheck":false}' },
      { method: 'GET', url: '/api/update/status', headers: { host: 'attacker.example' } },
    ] as const
    for (const attempt of attempts) {
      const response = await server.inject(attempt)
      expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(403)
    }
  })

  it('requires the Origin port to match for state changes in a packaged build only', async () => {
    const mismatch = { host: '127.0.0.1:4174', origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' }
    const packaged = await app()
    const blocked = await packaged.inject({ method: 'PUT', url: '/api/update/settings', headers: mismatch, payload: '{"autoCheck":false}' })
    expect(blocked.statusCode).toBe(403)
    const { manager } = setup({
      fetchImpl: fakeFetch({}),
      install: { appRoot: tempDir(), currentVersion: '0.7.0', packageType: null, launcher: 'x' },
    })
    const dev = fastify()
    registerUpdateRoutes(dev, { updates: manager })
    await dev.ready()
    const allowed = await dev.inject({ method: 'PUT', url: '/api/update/settings', headers: mismatch, payload: '{"autoCheck":false}' })
    expect(allowed.statusCode).toBe(200)
  })

  it('persists the auto-check toggle through the API', async () => {
    const server = await app()
    const response = await server.inject({
      method: 'PUT',
      url: '/api/update/settings',
      headers: { host: '127.0.0.1:4174', 'content-type': 'application/json' },
      payload: '{"autoCheck":false}',
    })
    expect(response.json().settings.autoCheck).toBe(false)
  })
})
