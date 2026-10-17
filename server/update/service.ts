import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { extractArchive } from './archive'
import { pickReleaseAsset, type PackageType, type ReleaseAsset } from './assets'
import { downloadText, downloadToFile, type FetchLike } from './download'
import type { InstallInfo } from './install'
import { summarizeReleaseNotes } from './notes'
import {
  getUpdateSettings,
  readCachedLatest,
  recordCheck,
  setAutoCheck,
  shouldAutoCheck,
  type SettingsStore,
  type UpdateSettings,
} from './settings'
import { isAllowedDownloadUrl } from './urls'
import { expectedSha256, verifyFileSha256 } from './verify'
import { isNewerVersion, parseVersion } from './version'

export const RELEASES_API_URL = 'https://api.github.com/repos/Rinne414/pixiv-to-manga/releases/latest'
/** Exit code the launchers treat as "restarting for an update". */
export const UPDATE_EXIT_CODE = 75

const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024
const MAX_CHECKSUM_BYTES = 256 * 1024
const NOTES_SUMMARY_LENGTH = 420
const API_TIMEOUT_MS = 15_000
const EXIT_DELAY_MS = 800

const releaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.string(),
  body: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  assets: z.array(
    z.object({
      name: z.string(),
      size: z.number().optional(),
      browser_download_url: z.string(),
      digest: z.string().nullable().optional(),
    }),
  ),
})

export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'verifying' | 'extracting' | 'restarting' | 'error'

export interface LatestRelease {
  version: string
  available: boolean
  notesSummary: string
  releaseUrl: string
  publishedAt: string | null
  /** True when this release has a package for the running platform. */
  hasPackage: boolean
  assetName: string | null
}

export interface UpdateResultFile {
  ok: boolean
  version?: string
  error?: string
  at?: string
}

export interface UpdateStatus {
  currentVersion: string
  packageType: PackageType | null
  canInstall: boolean
  settings: UpdateSettings
  latest: LatestRelease | null
  phase: UpdatePhase
  progress: number | null
  error: string | null
  lastResult: UpdateResultFile | null
}

export interface UpdateManagerOptions {
  settings: SettingsStore
  install: InstallInfo
  dataDir: string
  fetchImpl?: FetchLike
  /** Starts the apply helper; resolves once it is running. Replaceable in tests. */
  launchHelper?: (command: string, args: string[]) => Promise<void>
  exit?: (code: number) => void
  workDir?: string
  now?: () => number
}

interface CachedLatest extends LatestRelease {
  asset: ReleaseAsset | null
  checksumAsset: ReleaseAsset | null
}

export class UpdateManager {
  private phase: UpdatePhase = 'idle'
  private progress: number | null = null
  private error: string | null = null
  private cached: CachedLatest | null = null
  private readonly fetchImpl: FetchLike
  private readonly workDir: string
  private readonly lastResult: UpdateResultFile | null

  private readonly options: UpdateManagerOptions

  constructor(options: UpdateManagerOptions) {
    this.options = options
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
    this.workDir = options.workDir ?? path.join(os.tmpdir(), 'pixiv-to-manga-update')
    this.cached = parseCached(readCachedLatest(options.settings))
    this.lastResult = this.consumeResultFile()
  }

  status(): UpdateStatus {
    const latest = this.cached ? publicLatest(this.cached, this.options.install.currentVersion) : null
    return {
      currentVersion: this.options.install.currentVersion,
      packageType: this.options.install.packageType,
      canInstall: this.options.install.packageType !== null,
      settings: getUpdateSettings(this.options.settings),
      latest,
      phase: this.phase,
      progress: this.progress,
      error: this.error,
      lastResult: this.lastResult,
    }
  }

  setAutoCheck(enabled: boolean): UpdateStatus {
    setAutoCheck(this.options.settings, enabled)
    return this.status()
  }

  /** Runs at server start: a quiet check, at most every six hours, only when the user allows it. */
  async autoCheckOnStart(): Promise<void> {
    const now = (this.options.now ?? Date.now)()
    if (!shouldAutoCheck(getUpdateSettings(this.options.settings), now)) return
    try {
      await this.check()
    } catch {
      // A failed background check is not worth interrupting the user; the manual button reports errors.
    }
  }

  async check(): Promise<UpdateStatus> {
    this.assertIdle()
    this.begin('checking')
    try {
      const response = await this.fetchImpl(RELEASES_API_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'pixiv-to-manga-updater' },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`GitHub answered HTTP ${response.status} while checking for updates`)
      const release = releaseSchema.parse(await response.json())
      this.cached = this.fromRelease(release)
      const checkedAt = new Date((this.options.now ?? Date.now)()).toISOString()
      recordCheck(this.options.settings, checkedAt, JSON.stringify(this.cached))
      this.finish()
    } catch (error) {
      this.fail(error)
      throw error
    }
    return this.status()
  }

  /** Starts the download in the background; progress is read through status(). */
  startInstall(): void {
    this.assertIdle()
    const { packageType } = this.options.install
    const cached = this.cached
    if (packageType === null) {
      throw new Error('This copy runs from source or npm. Update it with git pull (or npm update) instead.')
    }
    if (!cached || !cached.available) throw new Error('There is no newer version to install. Check for updates first.')
    if (!cached.asset) throw new Error(`Release ${cached.version} has no package for this platform (${packageType}).`)
    this.begin('downloading')
    void this.runInstall(cached, cached.asset, cached.checksumAsset).catch((error) => this.fail(error))
  }

  private fromRelease(release: z.infer<typeof releaseSchema>): CachedLatest {
    const version = release.tag_name.replace(/^v/, '')
    if (!parseVersion(version)) throw new Error(`Release tag "${release.tag_name}" is not a version number`)
    const { packageType, currentVersion } = this.options.install
    const picked = packageType ? pickReleaseAsset(release.assets, version, packageType) : null
    return {
      version,
      available: isNewerVersion(version, currentVersion),
      notesSummary: summarizeReleaseNotes(release.body, NOTES_SUMMARY_LENGTH),
      releaseUrl: release.html_url,
      publishedAt: release.published_at ?? null,
      hasPackage: picked !== null,
      assetName: picked?.asset.name ?? null,
      asset: picked?.asset ?? null,
      checksumAsset: picked?.checksumAsset ?? null,
    }
  }

  private async runInstall(latest: CachedLatest, asset: ReleaseAsset, checksumAsset: ReleaseAsset | null): Promise<void> {
    if (!isAllowedDownloadUrl(asset.browser_download_url)) {
      throw new Error('The release points at a download location this app does not trust.')
    }
    const jobDir = path.join(this.workDir, latest.version)
    rmSync(this.workDir, { recursive: true, force: true })
    mkdirSync(jobDir, { recursive: true })
    const archivePath = path.join(jobDir, 'package.bin')
    const downloadOptions = { fetchImpl: this.fetchImpl, maxBytes: MAX_PACKAGE_BYTES }

    this.setPhase('downloading')
    await downloadToFile(asset.browser_download_url, archivePath, {
      ...downloadOptions,
      onProgress: (received, total) => {
        const expected = total ?? asset.size ?? null
        this.progress = expected ? Math.min(1, received / expected) : null
      },
    })

    this.setPhase('verifying')
    const sums =
      checksumAsset && !expectedSha256(asset, null)
        ? await downloadText(checksumAsset.browser_download_url, { ...downloadOptions, maxBytes: MAX_CHECKSUM_BYTES })
        : null
    const expected = expectedSha256(asset, sums)
    if (!expected) throw new Error('The release has no SHA256 checksum for this package, so it was not installed.')
    await verifyFileSha256(archivePath, expected)

    this.setPhase('extracting')
    const stagedRoot = path.join(jobDir, 'staged')
    await extractArchive(archivePath, stagedRoot)
    this.assertStagedPackage(stagedRoot, latest.version)
    rmSync(archivePath, { force: true })

    this.setPhase('restarting')
    await this.handOff(jobDir, stagedRoot, latest.version)
  }

  private assertStagedPackage(stagedRoot: string, version: string): void {
    const pkgPath = path.join(stagedRoot, 'package.json')
    if (!existsSync(pkgPath) || !existsSync(path.join(stagedRoot, 'dist-server', 'index.mjs'))) {
      throw new Error('The downloaded package does not look like a Pixiv-to-Manga Studio release.')
    }
    const staged = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    if (staged.version !== version) {
      throw new Error(`The package contains version ${staged.version ?? 'unknown'}, not the announced ${version}.`)
    }
  }

  private async handOff(jobDir: string, stagedRoot: string, version: string): Promise<void> {
    const { appRoot, launcher } = this.options.install
    const helperPath = path.join(jobDir, 'apply-update.mjs')
    copyFileSync(path.join(appRoot, 'bin', 'apply-update.mjs'), helperPath)
    const jobPath = path.join(jobDir, 'job.json')
    writeFileSync(
      jobPath,
      JSON.stringify({ pid: process.pid, appRoot, stagedRoot, dataDir: this.options.dataDir, launcher, version }),
    )
    // The staged runtime is not in use by anything, so it can run the helper while the old one is replaced.
    const stagedNode = path.join(stagedRoot, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node')
    const command = existsSync(stagedNode) ? stagedNode : process.execPath

    await (this.options.launchHelper ?? launchDetached)(command, [helperPath, jobPath])
    const exit = this.options.exit ?? ((code: number) => process.exit(code))
    setTimeout(() => exit(UPDATE_EXIT_CODE), EXIT_DELAY_MS).unref()
  }

  private consumeResultFile(): UpdateResultFile | null {
    const file = path.join(this.options.dataDir, 'update-result.json')
    if (!existsSync(file)) return null
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as UpdateResultFile
    } catch {
      return null
    } finally {
      try {
        unlinkSync(file)
      } catch {
        // Already gone.
      }
    }
  }

  private assertIdle(): void {
    if (this.phase !== 'idle' && this.phase !== 'error') throw new Error('Another update step is already running.')
  }

  private begin(phase: UpdatePhase): void {
    this.phase = phase
    this.progress = null
    this.error = null
  }

  private setPhase(phase: UpdatePhase): void {
    this.phase = phase
    this.progress = null
  }

  private finish(): void {
    this.phase = 'idle'
    this.progress = null
  }

  private fail(error: unknown): void {
    this.phase = 'error'
    this.progress = null
    this.error = error instanceof Error ? error.message : 'Update failed'
  }
}

function publicLatest(cached: CachedLatest, currentVersion: string): LatestRelease {
  return {
    version: cached.version,
    // Re-evaluated against the running version: a cached "available" is stale after an update.
    available: isNewerVersion(cached.version, currentVersion),
    notesSummary: cached.notesSummary,
    releaseUrl: cached.releaseUrl,
    publishedAt: cached.publishedAt,
    hasPackage: cached.hasPackage,
    assetName: cached.assetName,
  }
}

function parseCached(json: string): CachedLatest | null {
  if (!json) return null
  try {
    const value = JSON.parse(json) as CachedLatest
    return typeof value.version === 'string' && parseVersion(value.version) ? value : null
  } catch {
    return null
  }
}

function launchDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
