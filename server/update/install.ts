import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { PackageType } from './assets'

export const INSTALL_INFO_FILE = 'install-info.json'

const installInfoSchema = z.object({
  packageType: z.enum(['win-x64', 'linux-x64', 'portable']),
})

export interface InstallInfo {
  appRoot: string
  currentVersion: string
  /** Null when running from source, an npm install, or a dev server: nothing to replace. */
  packageType: PackageType | null
  launcher: string
}

/**
 * Release packages carry `install-info.json` beside package.json. Without it the app is not a
 * packaged build, so the update flow reports "use git pull" instead of touching any files.
 */
export function readInstallInfo(appRoot: string, platform: string = process.platform): InstallInfo {
  const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf8')) as { version?: string }
  const infoPath = path.join(appRoot, INSTALL_INFO_FILE)
  let packageType: PackageType | null = null
  if (existsSync(infoPath)) {
    try {
      const parsed = installInfoSchema.safeParse(JSON.parse(readFileSync(infoPath, 'utf8')))
      if (parsed.success) packageType = parsed.data.packageType
    } catch {
      // A damaged marker means "not a packaged build"; never let it stop the studio from starting.
    }
  }
  return {
    appRoot,
    currentVersion: pkg.version ?? '0.0.0',
    packageType,
    launcher: platform === 'win32' ? 'start-portable.cmd' : 'start-portable.sh',
  }
}
