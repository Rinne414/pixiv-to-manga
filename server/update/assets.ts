export type PackageType = 'win-x64' | 'linux-x64' | 'portable'

export interface ReleaseAsset {
  name: string
  size?: number
  browser_download_url: string
  digest?: string | null
}

export const CHECKSUM_ASSET_NAME = 'SHA256SUMS.txt'

/**
 * Only the two bundled-runtime packages are platform specific; everything else
 * (macOS, ARM, or a Node-required package) updates with the portable zip.
 */
export function detectPackageType(platform: string, arch: string, hasBundledRuntime: boolean): PackageType {
  if (hasBundledRuntime && arch === 'x64') {
    if (platform === 'win32') return 'win-x64'
    if (platform === 'linux') return 'linux-x64'
  }
  return 'portable'
}

/** File name of the Node binary in a bundled-runtime package's `runtime/` folder (the portable zip has none). */
export function runtimeBinaryName(type: PackageType): string {
  return type === 'win-x64' ? 'node.exe' : 'node'
}

export function assetNameFor(version: string, type: PackageType): string {
  const extension = type === 'linux-x64' ? 'tar.gz' : 'zip'
  return `pixiv-to-manga-${version}-${type}.${extension}`
}

export interface PickedAsset {
  asset: ReleaseAsset
  checksumAsset: ReleaseAsset | null
}

export function pickReleaseAsset(assets: ReleaseAsset[], version: string, type: PackageType): PickedAsset | null {
  const wanted = assetNameFor(version, type)
  const asset = assets.find((candidate) => candidate.name === wanted)
  if (!asset) return null
  return { asset, checksumAsset: assets.find((candidate) => candidate.name === CHECKSUM_ASSET_NAME) ?? null }
}
