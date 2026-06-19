import { describe, expect, it } from 'vitest'
import { assertPixivImageUrl, extractPixivArtworkId } from '../src/shared/pixiv'

describe('extractPixivArtworkId', () => {
  it('accepts numeric artwork ids', () => {
    expect(extractPixivArtworkId('123456789')).toBe('123456789')
  })

  it('extracts ids from Pixiv artwork URLs', () => {
    expect(extractPixivArtworkId('https://www.pixiv.net/artworks/987654321')).toBe('987654321')
    expect(extractPixivArtworkId('https://www.pixiv.net/en/artworks/987654321')).toBe('987654321')
  })

  it('extracts legacy illust_id query values', () => {
    expect(extractPixivArtworkId('https://www.pixiv.net/member_illust.php?mode=medium&illust_id=456789')).toBe('456789')
  })

  it('rejects arbitrary URL hosts', () => {
    expect(extractPixivArtworkId('https://example.com/artworks/987654321')).toBeNull()
  })
})

describe('assertPixivImageUrl', () => {
  it('allows https pximg asset hosts', () => {
    expect(assertPixivImageUrl('https://i.pximg.net/img-original/img/2026/01/01/00/00/00/123_p0.jpg').hostname).toBe(
      'i.pximg.net',
    )
  })

  it('rejects non-Pixiv hosts and non-https URLs', () => {
    expect(() => assertPixivImageUrl('https://example.com/image.jpg')).toThrow(/Pixiv/)
    expect(() => assertPixivImageUrl('http://i.pximg.net/image.jpg')).toThrow(/Pixiv/)
  })
})
