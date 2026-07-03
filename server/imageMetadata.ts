import { inflateSync } from 'node:zlib'
import type { GenerationMetadata } from '../src/shared/types'
import { GENERATION_METADATA_LIMITS } from '../src/shared/schemas'
import { uniqueNonEmpty } from '../src/shared/text'

export type { GenerationMetadata, GenerationMetadataFormat } from '../src/shared/types'

export function extractImageMetadata(buffer: Buffer, mimeType: string): GenerationMetadata {
  const normalizedMime = mimeType.split(';')[0].trim().toLowerCase()
  if (normalizedMime === 'image/png') {
    return parseGenerationMetadataText(readPngTextChunks(buffer))
  }
  if (normalizedMime === 'image/jpeg') {
    return parseGenerationMetadataText(readJpegTextMetadata(buffer))
  }
  if (normalizedMime === 'image/webp') {
    return parseGenerationMetadataText(readWebpTextMetadata(buffer))
  }
  if (normalizedMime === 'image/svg+xml') {
    return parseGenerationMetadataText(readSvgMetadata(buffer))
  }
  return emptyMetadata({})
}

export function parseGenerationMetadataText(raw: Record<string, string>): GenerationMetadata {
  const normalizedRaw = normalizeRawMetadata(raw)
  const metadata =
    parseComfyMetadata(normalizedRaw) ||
    parseNovelAiMetadata(normalizedRaw) ||
    parseA1111Metadata(normalizedRaw) ||
    parsePlainMetadata(normalizedRaw) ||
    emptyMetadata(normalizedRaw)
  return clampMetadataToSchemaLimits(metadata)
}

function parsePlainMetadata(raw: Record<string, string>): GenerationMetadata | null {
  const prompt = firstString(raw, ['prompt', 'description', 'comment', 'parameters'])
  if (!prompt) return null
  return {
    format: 'plain',
    positivePrompt: prompt,
    tags: tagsFromPrompt(prompt),
    raw,
    settings: {},
    sourceFields: fieldsWithValues(raw, ['prompt', 'description', 'comment', 'parameters']),
  }
}

// Parsers read arbitrary embedded text, so the final result is clamped once here to the
// exact limits generationMetadataSchema enforces — otherwise an inspect response could
// fail its own /generate validation later.
function clampMetadataToSchemaLimits(metadata: GenerationMetadata): GenerationMetadata {
  const limits = GENERATION_METADATA_LIMITS
  return {
    ...metadata,
    positivePrompt: metadata.positivePrompt?.slice(0, limits.maxPromptLength),
    negativePrompt: metadata.negativePrompt?.slice(0, limits.maxPromptLength),
    tags: metadata.tags
      .map((tag) => tag.slice(0, limits.maxTagLength))
      .slice(0, limits.maxTagsPerReference),
    settings: Object.fromEntries(
      Object.entries(metadata.settings).map(([key, value]) => [
        key,
        typeof value === 'string' ? value.slice(0, limits.maxSettingValueLength) : value,
      ]),
    ),
    workflowSummary: metadata.workflowSummary
      ?.map((entry) => entry.slice(0, limits.maxWorkflowSummaryEntryLength))
      .slice(0, limits.maxWorkflowSummaryEntries),
  }
}

function parseA1111Metadata(raw: Record<string, string>): GenerationMetadata | null {
  const parameters = firstString(raw, ['parameters', 'comment', 'UserComment'])
  if (!parameters || !/(negative prompt:|steps:|sampler:|cfg scale:|seed:)/i.test(parameters)) {
    return null
  }

  const lines = parameters.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const negativeIndex = lines.findIndex((line) => /^negative prompt:/i.test(line))
  const settingsIndex = lines.findIndex((line) => /\b(steps|sampler|cfg scale|seed|size):/i.test(line))
  const positiveEnd = firstNonNegativeIndex([negativeIndex, settingsIndex], lines.length)
  const positivePrompt = lines.slice(0, positiveEnd).join('\n').trim()
  const negativePrompt =
    negativeIndex >= 0
      ? lines
          .slice(negativeIndex, settingsIndex > negativeIndex ? settingsIndex : lines.length)
          .join('\n')
          .replace(/^negative prompt:\s*/i, '')
          .trim()
      : undefined
  const settingsLine = settingsIndex >= 0 ? lines.slice(settingsIndex).join(', ') : ''

  return {
    format: 'a1111',
    positivePrompt,
    negativePrompt,
    tags: tagsFromPrompt(positivePrompt),
    raw,
    settings: parseSettingsLine(settingsLine),
    sourceFields: fieldsWithValues(raw, ['parameters', 'comment', 'UserComment']),
  }
}

function parseNovelAiMetadata(raw: Record<string, string>): GenerationMetadata | null {
  const candidates = ['Comment', 'comment', 'Description', 'description', 'parameters']
    .map((key) => raw[key])
    .filter((value): value is string => Boolean(value))

  for (const candidate of candidates) {
    const parsed = parseJsonObject(candidate)
    if (!parsed) continue
    const prompt = stringValue(parsed.prompt) || stringValue(parsed.Prompt) || stringValue(parsed.description)
    const negative = stringValue(parsed.uc) || stringValue(parsed.negative_prompt) || stringValue(parsed.negativePrompt)
    if (!prompt && !negative) continue

    const settings: Record<string, string | number | boolean> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (['prompt', 'Prompt', 'description', 'uc', 'negative_prompt', 'negativePrompt'].includes(key)) continue
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        settings[key] = value
      }
    }

    return {
      format: 'novelai',
      positivePrompt: prompt,
      negativePrompt: negative,
      tags: tagsFromPrompt(prompt || ''),
      raw,
      settings,
      sourceFields: fieldsWithValues(raw, ['Comment', 'comment', 'Description', 'description', 'parameters']),
    }
  }

  return null
}

function parseComfyMetadata(raw: Record<string, string>): GenerationMetadata | null {
  const workflowText = firstString(raw, ['workflow', 'Workflow', 'prompt', 'Prompt'])
  const parsed = workflowText ? parseJsonObject(workflowText) : null
  if (!parsed) return null

  const promptTexts: string[] = []
  const summary: string[] = []
  const settings: Record<string, string | number | boolean> = {}
  walkComfyObject(parsed, promptTexts, summary, settings)

  if (!promptTexts.length && !summary.length) {
    return null
  }

  const positivePrompt = uniqueNonEmpty(promptTexts).join(', ')
  return {
    format: 'comfyui',
    positivePrompt,
    tags: tagsFromPrompt(positivePrompt),
    raw,
    settings,
    sourceFields: fieldsWithValues(raw, ['workflow', 'Workflow', 'prompt', 'Prompt']),
    workflowSummary: uniqueNonEmpty(summary).slice(0, 12),
  }
}

function walkComfyObject(
  value: unknown,
  promptTexts: string[],
  summary: string[],
  settings: Record<string, string | number | boolean>,
): void {
  if (!value || typeof value !== 'object') {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      walkComfyObject(item, promptTexts, summary, settings)
    }
    return
  }

  const record = value as Record<string, unknown>
  const classType = stringValue(record.class_type) || stringValue(record.type)
  const inputs = record.inputs && typeof record.inputs === 'object' ? (record.inputs as Record<string, unknown>) : record
  const text = stringValue(inputs.text) || stringValue(inputs.prompt)
  if (text && text.length <= 3000) {
    promptTexts.push(text)
    if (classType) {
      summary.push(`${classType}: ${text}`)
    }
  }

  for (const key of ['seed', 'steps', 'cfg', 'cfg_scale', 'sampler_name', 'scheduler', 'denoise']) {
    const candidate = inputs[key]
    if (typeof candidate === 'string' || typeof candidate === 'number' || typeof candidate === 'boolean') {
      settings[key] = candidate
    }
  }

  for (const nested of Object.values(record)) {
    if (nested !== inputs) {
      walkComfyObject(nested, promptTexts, summary, settings)
    }
  }
}

function readPngTextChunks(buffer: Buffer): Record<string, string> {
  const raw: Record<string, string> = {}
  if (buffer.length < 8 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    return raw
  }

  let offset = 8
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (length < 0 || dataEnd + 4 > buffer.length) break

    const data = buffer.subarray(dataStart, dataEnd)
    if (type === 'tEXt') {
      const separator = data.indexOf(0)
      if (separator > 0) {
        raw[data.subarray(0, separator).toString('latin1')] = data.subarray(separator + 1).toString('utf8')
      }
    } else if (type === 'iTXt') {
      readInternationalTextChunk(raw, data)
    } else if (type === 'zTXt') {
      readCompressedTextChunk(raw, data)
    }

    offset = dataEnd + 4
    if (type === 'IEND') break
  }
  return raw
}

function readInternationalTextChunk(raw: Record<string, string>, data: Buffer): void {
  const keywordEnd = data.indexOf(0)
  if (keywordEnd <= 0 || keywordEnd + 5 > data.length) return
  const keyword = data.subarray(0, keywordEnd).toString('latin1')
  const compressed = data[keywordEnd + 1] === 1
  let cursor = keywordEnd + 3
  const languageEnd = data.indexOf(0, cursor)
  if (languageEnd < 0) return
  cursor = languageEnd + 1
  const translatedEnd = data.indexOf(0, cursor)
  if (translatedEnd < 0) return
  cursor = translatedEnd + 1
  try {
    const textData = data.subarray(cursor)
    raw[keyword] = compressed ? inflateSync(textData).toString('utf8') : textData.toString('utf8')
  } catch {
    // Ignore malformed compressed metadata.
  }
}

function readCompressedTextChunk(raw: Record<string, string>, data: Buffer): void {
  const keywordEnd = data.indexOf(0)
  if (keywordEnd <= 0 || keywordEnd + 2 > data.length) return
  const keyword = data.subarray(0, keywordEnd).toString('latin1')
  try {
    raw[keyword] = inflateSync(data.subarray(keywordEnd + 2)).toString('utf8')
  } catch {
    // Ignore malformed compressed metadata.
  }
}

function readJpegTextMetadata(buffer: Buffer): Record<string, string> {
  const raw: Record<string, string> = {}
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return raw

  let offset = 2
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = buffer[offset + 1]
    if (marker === 0xda || marker === 0xd9) break
    const length = buffer.readUInt16BE(offset + 2)
    if (length < 2 || offset + 2 + length > buffer.length) break
    const data = buffer.subarray(offset + 4, offset + 2 + length)

    if (marker === 0xfe) {
      raw.Comment = data.toString('utf8').replace(/\0+$/, '')
    } else if (marker === 0xe1) {
      if (data.length > 6 && data.toString('ascii', 0, 4) === 'Exif') {
        readExifMetadata(data.subarray(6), raw)
      } else {
        const text = data.toString('utf8')
        if (text.includes('<x:xmpmeta')) {
          readXmpMetadata(text, raw)
        }
      }
    }
    offset += 2 + length
  }
  return raw
}

const EXIF_TAG_IMAGE_DESCRIPTION = 0x010e
const EXIF_TAG_EXIF_IFD_POINTER = 0x8769
const EXIF_TAG_USER_COMMENT = 0x9286
const EXIF_TAG_XP_COMMENT = 0x9c9c
const EXIF_TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }
const MAX_EXIF_VALUE_BYTES = 1_000_000
const MAX_EXIF_IFD_DEPTH = 3

// EXIF stores values in binary TIFF IFDs (UserComment is tag 0x9286, not a text keyword),
// so this walks IFD0 and the Exif sub-IFD instead of string-searching the payload.
function readExifMetadata(tiff: Buffer, raw: Record<string, string>): void {
  if (tiff.length < 8) return
  const byteOrder = tiff.toString('ascii', 0, 2)
  if (byteOrder !== 'II' && byteOrder !== 'MM') return
  const littleEndian = byteOrder === 'II'
  const readUInt16 = (offset: number): number => (littleEndian ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset))
  const readUInt32 = (offset: number): number => (littleEndian ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset))
  if (readUInt16(2) !== 42) return

  const visitIfd = (ifdOffset: number, depth: number): void => {
    if (depth > MAX_EXIF_IFD_DEPTH || ifdOffset <= 0 || ifdOffset + 2 > tiff.length) return
    const entryCount = readUInt16(ifdOffset)
    for (let index = 0; index < entryCount; index += 1) {
      const entryOffset = ifdOffset + 2 + index * 12
      if (entryOffset + 12 > tiff.length) return
      const tag = readUInt16(entryOffset)
      if (tag === EXIF_TAG_EXIF_IFD_POINTER) {
        visitIfd(readUInt32(entryOffset + 8), depth + 1)
        continue
      }
      const type = readUInt16(entryOffset + 2)
      const count = readUInt32(entryOffset + 4)
      const byteLength = count * (EXIF_TYPE_SIZES[type] ?? 1)
      if (byteLength <= 0 || byteLength > MAX_EXIF_VALUE_BYTES) continue
      const valueOffset = byteLength <= 4 ? entryOffset + 8 : readUInt32(entryOffset + 8)
      if (valueOffset < 0 || valueOffset + byteLength > tiff.length) continue
      const value = tiff.subarray(valueOffset, valueOffset + byteLength)

      if (tag === EXIF_TAG_USER_COMMENT) {
        const comment = decodeExifUserComment(value)
        if (comment) raw.UserComment = raw.UserComment || comment
      } else if (tag === EXIF_TAG_IMAGE_DESCRIPTION) {
        const description = cleanNullPadded(value.toString('utf8'))
        if (description) raw.Description = raw.Description || description
      } else if (tag === EXIF_TAG_XP_COMMENT) {
        const comment = cleanNullPadded(value.toString('utf16le'))
        if (comment) raw.Comment = raw.Comment || comment
      }
    }
  }

  try {
    visitIfd(readUInt32(4), 0)
  } catch {
    // Malformed EXIF is ignored; metadata extraction is best-effort.
  }
}

function decodeExifUserComment(value: Buffer): string | undefined {
  if (value.length <= 8) return undefined
  const charset = value.toString('ascii', 0, 8)
  const payload = value.subarray(8)
  if (charset.startsWith('UNICODE')) return decodeUtf16(payload)
  if (charset.startsWith('ASCII')) return cleanNullPadded(payload.toString('ascii'))
  if (charset.startsWith('JIS')) return undefined
  // Zero-filled or nonstandard charset headers: treat the whole value as UTF-8 text.
  const isZeroCharset = value.subarray(0, 8).every((byte) => byte === 0)
  return cleanNullPadded((isZeroCharset ? payload : value).toString('utf8'))
}

// The EXIF spec leaves UNICODE byte order to the TIFF header, but writers disagree
// (A1111/piexif emit UTF-16BE regardless), so decode both and keep the readable one.
function decodeUtf16(payload: Buffer): string | undefined {
  if (payload.length >= 2 && payload[0] === 0xff && payload[1] === 0xfe) {
    return cleanNullPadded(payload.subarray(2).toString('utf16le'))
  }
  if (payload.length >= 2 && payload[0] === 0xfe && payload[1] === 0xff) {
    return cleanNullPadded(swapBytePairs(payload.subarray(2)).toString('utf16le'))
  }
  const littleEndian = cleanNullPadded(payload.toString('utf16le')) || ''
  const bigEndian = cleanNullPadded(swapBytePairs(payload).toString('utf16le')) || ''
  const best = printableScore(bigEndian) > printableScore(littleEndian) ? bigEndian : littleEndian
  return best || undefined
}

function swapBytePairs(payload: Buffer): Buffer {
  const evenLength = payload.length - (payload.length % 2)
  const copy = Buffer.from(payload.subarray(0, evenLength))
  copy.swap16()
  return copy
}

// Wrong-endian UTF-16 turns ASCII into CJK-range code units, so ASCII weighs positive,
// controls/replacement negative, and other scripts neutral — the correct decode of a
// typical prompt (ASCII tags plus optional CJK) always outscores its byte-swapped twin.
function printableScore(value: string): number {
  let score = 0
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code === 0xfffd) {
      score -= 2
    } else if (char === '\n' || char === '\r' || char === '\t') {
      score += 2
    } else if (code >= 0x20 && code <= 0x7e) {
      score += 2
    } else if (code < 0x20) {
      score -= 2
    }
  }
  return score
}

function cleanNullPadded(value: string): string | undefined {
  const cleaned = value.replace(/\0+/g, '').trim()
  return cleaned || undefined
}

function readXmpMetadata(xmp: string, raw: Record<string, string>): void {
  raw.xmp = xmp
  const block = xmp.match(
    /<(?:dc:description|exif:UserComment)[^>]*>([\s\S]*?)<\/(?:dc:description|exif:UserComment)>/i,
  )?.[1]
  if (!block) return
  const item = block.match(/<rdf:li[^>]*>([\s\S]*?)<\/rdf:li>/i)?.[1] ?? block
  const description = stripXml(item)
  if (description) {
    raw.description = raw.description || description
  }
}

function readWebpTextMetadata(buffer: Buffer): Record<string, string> {
  const raw: Record<string, string> = {}
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return raw
  }

  let offset = 12
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4)
    const length = buffer.readUInt32LE(offset + 4)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd > buffer.length) break
    if (type === 'EXIF') {
      const payload = buffer.subarray(dataStart, dataEnd)
      const tiff = payload.length > 6 && payload.toString('ascii', 0, 4) === 'Exif' ? payload.subarray(6) : payload
      readExifMetadata(tiff, raw)
    }
    if (type === 'XMP ') {
      readXmpMetadata(buffer.subarray(dataStart, dataEnd).toString('utf8'), raw)
    }
    offset = dataEnd + (length % 2)
  }
  return raw
}

function readSvgMetadata(buffer: Buffer): Record<string, string> {
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, 80_000))
  const raw: Record<string, string> = {}
  const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const description = text.match(/<desc[^>]*>([\s\S]*?)<\/desc>/i)?.[1]
  if (title) raw.title = stripXml(title)
  if (description) raw.description = stripXml(description)
  return raw
}

function normalizeRawMetadata(raw: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!value) continue
    normalized[key] = value.trim().slice(0, 100_000)
  }
  return normalized
}

function parseSettingsLine(line: string): Record<string, string> {
  const settings: Record<string, string> = {}
  for (const part of line.split(/,\s*/)) {
    const match = part.match(/^([^:]+):\s*(.+)$/)
    if (match) {
      settings[match[1].trim()] = match[2].trim()
    }
  }
  return settings
}

function tagsFromPrompt(prompt: string): string[] {
  return uniqueNonEmpty(
    prompt
      .split(',')
      .map((tag) =>
        tag
          .replace(/[\r\n]+/g, ' ')
          .replace(/[()[\]{}]/g, '')
          .replace(/:[0-9.]+/g, '')
          .trim(),
      )
      .filter((tag) => tag.length > 1 && tag.length <= 80),
  ).slice(0, 80)
}

function firstString(raw: Record<string, string>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (raw[key]) return raw[key]
  }
  const lowerMap = new Map(Object.entries(raw).map(([key, value]) => [key.toLowerCase(), value]))
  for (const key of keys) {
    const value = lowerMap.get(key.toLowerCase())
    if (value) return value
  }
  return undefined
}

function fieldsWithValues(raw: Record<string, string>, keys: string[]): string[] {
  const lowerKeys = new Set(keys.map((key) => key.toLowerCase()))
  return Object.keys(raw).filter((key) => lowerKeys.has(key.toLowerCase()))
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function firstNonNegativeIndex(values: number[], fallback: number): number {
  return values.filter((value) => value >= 0).sort((a, b) => a - b)[0] ?? fallback
}

function stripXml(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function emptyMetadata(raw: Record<string, string>): GenerationMetadata {
  return {
    format: Object.keys(raw).length ? 'plain' : 'unknown',
    tags: [],
    raw,
    settings: {},
    sourceFields: Object.keys(raw),
  }
}
