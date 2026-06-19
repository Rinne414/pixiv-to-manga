import { mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const appDataDir =
  process.env.PTM_DATA_DIR || path.join(os.homedir(), '.pixiv-to-manga-studio')

export const projectsDir = path.join(appDataDir, 'projects')
export const exportsDir = path.join(appDataDir, 'exports')
export const databasePath = path.join(appDataDir, 'studio.sqlite')

export function ensureAppDirs(): void {
  mkdirSync(projectsDir, { recursive: true })
  mkdirSync(exportsDir, { recursive: true })
}

export function projectDir(projectId: string): string {
  return path.join(projectsDir, projectId)
}

export function projectAssetDir(projectId: string, kind: string): string {
  const dir = path.join(projectDir(projectId), kind)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function assetUrlFromRelativePath(relativePath: string): string {
  return `/assets/${relativePath.replaceAll(path.sep, '/')}`
}
