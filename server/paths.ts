import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const appDataDir = getAppDataDir()
export const projectsDir = getProjectsDir()
export const exportsDir = getExportsDir()
export const databasePath = getDatabasePath()

export function getAppDataDir(): string {
  return process.env.PTM_DATA_DIR || path.join(os.homedir(), '.pixiv-to-manga-studio')
}

export function getProjectsDir(): string {
  return path.join(getAppDataDir(), 'projects')
}

export function getExportsDir(): string {
  return path.join(getAppDataDir(), 'exports')
}

export function getFontsDir(): string {
  return path.join(getAppDataDir(), 'fonts')
}

export function getDatabasePath(): string {
  return path.join(getAppDataDir(), 'studio.sqlite')
}

export function ensureAppDirs(): void {
  mkdirSync(getProjectsDir(), { recursive: true })
  mkdirSync(getExportsDir(), { recursive: true })
  mkdirSync(getFontsDir(), { recursive: true })
}

export function projectDir(projectId: string): string {
  return path.join(getProjectsDir(), projectId)
}

export function projectAssetDir(projectId: string, kind: string): string {
  const dir = path.join(projectDir(projectId), kind)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function assetUrlFromRelativePath(relativePath: string): string {
  return `/assets/${relativePath.replaceAll(path.sep, '/')}`
}
