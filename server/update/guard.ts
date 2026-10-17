const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

type HeaderBag = Record<string, string | string[] | undefined>

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function hostnameOf(hostHeader: string): string {
  // `[::1]:4174` keeps its brackets; `127.0.0.1:4174` drops the port.
  if (hostHeader.startsWith('[')) {
    const end = hostHeader.indexOf(']')
    return end === -1 ? hostHeader : hostHeader.slice(0, end + 1)
  }
  return hostHeader.split(':')[0]
}

/**
 * Update endpoints change files on disk, so they must only answer this machine's own pages:
 * a loopback Host (stops DNS rebinding), a loopback Origin when one is sent, and no
 * `Sec-Fetch-Site: cross-site`. Any loopback port is allowed so the Vite dev server still works.
 */
export interface GuardOptions {
  /** State-changing routes: the page's Origin must be on the very port that received the request. */
  requireSamePort?: boolean
}

function portOf(hostHeader: string): string {
  const match = /:(\d+)$/.exec(hostHeader)
  return match ? match[1] : '80'
}

export function isTrustedLocalRequest(headers: HeaderBag, options: GuardOptions = {}): boolean {
  const host = single(headers.host)
  if (!host || !LOOPBACK_HOSTS.has(hostnameOf(host).toLowerCase())) return false

  const origin = single(headers.origin)
  if (origin !== undefined) {
    let parsed: URL
    try {
      parsed = new URL(origin)
    } catch {
      return false
    }
    // WHATWG URL keeps the brackets on IPv6 hostnames, matching LOOPBACK_HOSTS.
    if (parsed.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return false
    if (options.requireSamePort && (parsed.port || '80') !== portOf(host)) return false
  }

  return single(headers['sec-fetch-site']) !== 'cross-site'
}
