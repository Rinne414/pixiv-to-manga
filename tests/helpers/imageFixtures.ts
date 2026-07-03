import { deflateSync } from 'node:zlib'

export function pngChunk(type: string, data: Buffer): Buffer {
  const output = Buffer.alloc(12 + data.length)
  output.writeUInt32BE(data.length, 0)
  output.write(type, 4, 'ascii')
  data.copy(output, 8)
  output.writeUInt32BE(0, 8 + data.length)
  return output
}

export function pngFromChunks(chunks: Array<{ type: string; data: Buffer }>): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(640, 0)
  ihdrData.writeUInt32BE(960, 4)
  ihdrData[8] = 8
  ihdrData[9] = 2
  const body = chunks.map((item) => pngChunk(item.type, item.data))
  return Buffer.concat([signature, pngChunk('IHDR', ihdrData), ...body, pngChunk('IEND', Buffer.alloc(0))])
}

export function pngWithText(chunks: Record<string, string>): Buffer {
  return pngFromChunks(
    Object.entries(chunks).map(([keyword, text]) => ({
      type: 'tEXt',
      data: Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'utf8')]),
    })),
  )
}

export function pngWithCompressedText(chunks: Record<string, string>): Buffer {
  return pngFromChunks(
    Object.entries(chunks).map(([keyword, text]) => ({
      type: 'zTXt',
      data: Buffer.concat([
        Buffer.from(keyword, 'latin1'),
        Buffer.from([0, 0]),
        deflateSync(Buffer.from(text, 'utf8')),
      ]),
    })),
  )
}

export function a1111Parameters(): string {
  return (
    'same heroine, school rooftop, sunset\n' +
    'Negative prompt: low quality\n' +
    'Steps: 20, Sampler: Euler a, CFG scale: 7, Seed: 42, Size: 640x960'
  )
}

export function pngWithA1111Parameters(): Buffer {
  return pngWithText({ parameters: a1111Parameters() })
}

/** TIFF (little-endian) with IFD0 -> Exif IFD -> UserComment tag 0x9286 (UNICODE / UTF-16BE). */
export function tiffWithUserComment(text: string): Buffer {
  const encoded = Buffer.from(text, 'utf16le')
  const bigEndianText = Buffer.from(encoded)
  bigEndianText.swap16()
  const comment = Buffer.concat([Buffer.from('UNICODE\0', 'latin1'), bigEndianText])

  const header = Buffer.alloc(8)
  header.write('II', 0, 'ascii')
  header.writeUInt16LE(42, 2)
  header.writeUInt32LE(8, 4)

  const ifd0 = Buffer.alloc(2 + 12 + 4)
  const exifIfdOffset = 8 + ifd0.length
  ifd0.writeUInt16LE(1, 0)
  ifd0.writeUInt16LE(0x8769, 2)
  ifd0.writeUInt16LE(4, 4)
  ifd0.writeUInt32LE(1, 6)
  ifd0.writeUInt32LE(exifIfdOffset, 10)
  ifd0.writeUInt32LE(0, 14)

  const exifIfd = Buffer.alloc(2 + 12 + 4)
  const dataOffset = exifIfdOffset + exifIfd.length
  exifIfd.writeUInt16LE(1, 0)
  exifIfd.writeUInt16LE(0x9286, 2)
  exifIfd.writeUInt16LE(7, 4)
  exifIfd.writeUInt32LE(comment.length, 6)
  exifIfd.writeUInt32LE(dataOffset, 10)
  exifIfd.writeUInt32LE(0, 14)

  return Buffer.concat([header, ifd0, exifIfd, comment])
}

export function jpegWithExifUserComment(text: string): Buffer {
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiffWithUserComment(text)])
  const length = Buffer.alloc(2)
  length.writeUInt16BE(payload.length + 2, 0)
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe1]),
    length,
    payload,
    Buffer.from([0xff, 0xd9]),
  ])
}

export function webpWithExifUserComment(text: string): Buffer {
  const exifChunk = riffChunk('EXIF', tiffWithUserComment(text))
  const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), exifChunk])
  const header = Buffer.alloc(8)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(body.length, 4)
  return Buffer.concat([header, body])
}

function riffChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.write(type, 0, 'ascii')
  head.writeUInt32LE(data.length, 4)
  const padding = data.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)
  return Buffer.concat([head, data, padding])
}
