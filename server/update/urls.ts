const ALLOWED_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  // GitHub currently redirects release downloads to this host.
  'release-assets.githubusercontent.com',
])

/** HTTPS, default port, no credentials, and an exact GitHub host. */
export function isAllowedDownloadUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return url.protocol === 'https:' && !url.username && !url.password && url.port === '' && ALLOWED_HOSTS.has(url.hostname)
}

const RELEASE_DOWNLOAD_PREFIX = '/rinne414/pixiv-to-manga/releases/download/'

/** The first hop of an asset download must be this repository's own release download. */
export function isReleaseDownloadUrl(value: string): boolean {
  if (!isAllowedDownloadUrl(value)) return false
  const url = new URL(value)
  return url.hostname === 'github.com' && url.pathname.toLowerCase().startsWith(RELEASE_DOWNLOAD_PREFIX)
}
