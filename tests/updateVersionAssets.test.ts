import { describe, expect, it } from 'vitest'
import { compareVersions, isNewerVersion, parseVersion } from '../server/update/version'
import { assetNameFor, detectPackageType, pickReleaseAsset } from '../server/update/assets'
import { isAllowedDownloadUrl } from '../server/update/urls'
import { summarizeReleaseNotes } from '../server/update/notes'

describe('version compare', () => {
  it('parses plain and v-prefixed tags', () => {
    expect(parseVersion('v0.8.0')).toMatchObject({ major: 0, minor: 8, patch: 0 })
    expect(parseVersion('1.2.3')).toMatchObject({ major: 1, minor: 2, patch: 3 })
    expect(parseVersion('not-a-version')).toBeNull()
    expect(parseVersion('1.2')).toBeNull()
  })

  it('orders numerically, not lexically', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('v0.8.0', '0.8.0')).toBe(0)
    expect(compareVersions('0.7.9', '0.8.0')).toBeLessThan(0)
  })

  it('ranks a prerelease below its release', () => {
    expect(compareVersions('0.8.0-beta.1', '0.8.0')).toBeLessThan(0)
    expect(compareVersions('0.8.0-beta.2', '0.8.0-beta.10')).toBeLessThan(0)
  })

  it('isNewerVersion is false for equal, older, or unparseable versions', () => {
    expect(isNewerVersion('0.8.0', '0.7.0')).toBe(true)
    expect(isNewerVersion('0.7.0', '0.7.0')).toBe(false)
    expect(isNewerVersion('0.6.0', '0.7.0')).toBe(false)
    expect(isNewerVersion('garbage', '0.7.0')).toBe(false)
  })
})

describe('package type and asset pick', () => {
  const assets = [
    { name: 'pixiv-to-manga-0.8.0-win-x64.zip', size: 10, browser_download_url: 'https://github.com/x/win', digest: 'sha256:' + 'a'.repeat(64) },
    { name: 'pixiv-to-manga-0.8.0-linux-x64.tar.gz', size: 10, browser_download_url: 'https://github.com/x/linux', digest: null },
    { name: 'pixiv-to-manga-0.8.0-portable.zip', size: 10, browser_download_url: 'https://github.com/x/portable' },
    { name: 'SHA256SUMS.txt', size: 1, browser_download_url: 'https://github.com/x/sums' },
  ]

  it('detects the package type from platform and bundled runtime', () => {
    expect(detectPackageType('win32', 'x64', true)).toBe('win-x64')
    expect(detectPackageType('linux', 'x64', true)).toBe('linux-x64')
    expect(detectPackageType('linux', 'x64', false)).toBe('portable')
    expect(detectPackageType('darwin', 'arm64', false)).toBe('portable')
    expect(detectPackageType('win32', 'arm64', true)).toBe('portable')
  })

  it('names assets deterministically', () => {
    expect(assetNameFor('0.8.0', 'win-x64')).toBe('pixiv-to-manga-0.8.0-win-x64.zip')
    expect(assetNameFor('0.8.0', 'linux-x64')).toBe('pixiv-to-manga-0.8.0-linux-x64.tar.gz')
    expect(assetNameFor('0.8.0', 'portable')).toBe('pixiv-to-manga-0.8.0-portable.zip')
  })

  it('picks the asset for the running package type and the checksum file', () => {
    const win = pickReleaseAsset(assets, '0.8.0', 'win-x64')
    expect(win?.asset.name).toBe('pixiv-to-manga-0.8.0-win-x64.zip')
    expect(win?.checksumAsset?.name).toBe('SHA256SUMS.txt')
    expect(pickReleaseAsset(assets, '0.8.0', 'linux-x64')?.asset.name).toBe('pixiv-to-manga-0.8.0-linux-x64.tar.gz')
    expect(pickReleaseAsset(assets, '0.8.0', 'portable')?.asset.name).toBe('pixiv-to-manga-0.8.0-portable.zip')
  })

  it('never falls back to another platform package', () => {
    const onlyLinux = assets.filter((asset) => asset.name.includes('linux'))
    expect(pickReleaseAsset(onlyLinux, '0.8.0', 'win-x64')).toBeNull()
  })
})

describe('download url allow-list', () => {
  it('accepts https github hosts only', () => {
    expect(isAllowedDownloadUrl('https://github.com/Rinne414/pixiv-to-manga/releases/download/v0.8.0/a.zip')).toBe(true)
    expect(isAllowedDownloadUrl('https://objects.githubusercontent.com/abc')).toBe(true)
    expect(isAllowedDownloadUrl('https://release-assets.githubusercontent.com/abc')).toBe(true)
  })

  it('rejects http, lookalikes, credentials, and other hosts', () => {
    expect(isAllowedDownloadUrl('http://github.com/a')).toBe(false)
    expect(isAllowedDownloadUrl('https://github.com.evil.example/a')).toBe(false)
    expect(isAllowedDownloadUrl('https://evilgithub.com/a')).toBe(false)
    expect(isAllowedDownloadUrl('https://user:pw@github.com/a')).toBe(false)
    expect(isAllowedDownloadUrl('https://127.0.0.1/a')).toBe(false)
    expect(isAllowedDownloadUrl('not a url')).toBe(false)
    expect(isAllowedDownloadUrl('https://github.com:8443/a')).toBe(false)
  })
})

describe('release notes summary', () => {
  it('strips markdown and truncates on a boundary', () => {
    const body = '## v0.8.0 - title\n\n**bold** [link](https://x.y) text\n\n' + 'word '.repeat(200)
    const summary = summarizeReleaseNotes(body, 120)
    expect(summary.length).toBeLessThanOrEqual(121)
    expect(summary).not.toContain('**')
    expect(summary).not.toContain('](')
    expect(summary.endsWith('…')).toBe(true)
  })

  it('returns an empty string for a missing body', () => {
    expect(summarizeReleaseNotes(null, 100)).toBe('')
  })
})
