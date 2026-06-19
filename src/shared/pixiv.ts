export function extractPixivArtworkId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d{3,}$/.test(trimmed)) {
    return trimmed
  }

  try {
    const url = new URL(trimmed)
    if (!['www.pixiv.net', 'pixiv.net'].includes(url.hostname.toLowerCase())) {
      return null
    }

    const artworkMatch = url.pathname.match(/\/(?:en\/)?artworks\/(\d+)/)
    if (artworkMatch) {
      return artworkMatch[1]
    }

    const illustId = url.searchParams.get('illust_id')
    return illustId && /^\d+$/.test(illustId) ? illustId : null
  } catch {
    return null
  }
}

export function assertPixivImageUrl(rawUrl: string): URL {
  const url = new URL(rawUrl)
  const host = url.hostname.toLowerCase()
  const allowed =
    host.endsWith('.pximg.net') ||
    host === 'i.pximg.net' ||
    host === 's.pximg.net'

  if (!allowed || url.protocol !== 'https:') {
    throw new Error('Only Pixiv image asset URLs are allowed')
  }

  return url
}
