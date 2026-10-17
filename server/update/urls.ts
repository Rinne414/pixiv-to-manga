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
