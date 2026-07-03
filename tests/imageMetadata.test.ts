import { describe, expect, it } from 'vitest'
import { extractImageMetadata, parseGenerationMetadataText } from '../server/imageMetadata'
import { generationMetadataSchema } from '../src/shared/schemas'
import {
  jpegWithExifUserComment,
  pngWithCompressedText,
  pngWithText,
  webpWithExifUserComment,
} from './helpers/imageFixtures'

describe('image generation metadata extraction', () => {
  it('extracts A1111 parameters from PNG text chunks', () => {
    const parameters =
      'solo girl, sailor uniform, blue sky, city street\n' +
      'Negative prompt: blurry, low quality\n' +
      'Steps: 28, Sampler: DPM++ 2M Karras, CFG scale: 7, Seed: 12345, Size: 768x1024'
    const buffer = pngWithText({ parameters })

    const metadata = extractImageMetadata(buffer, 'image/png')

    expect(metadata.format).toBe('a1111')
    expect(metadata.positivePrompt).toContain('solo girl')
    expect(metadata.negativePrompt).toBe('blurry, low quality')
    expect(metadata.tags).toContain('sailor uniform')
    expect(metadata.settings).toMatchObject({ Steps: '28', Sampler: 'DPM++ 2M Karras', Seed: '12345' })
    expect(() => generationMetadataSchema.parse(metadata)).not.toThrow()
  })

  it('extracts compressed PNG zTXt chunks', () => {
    const buffer = pngWithCompressedText({
      Comment: JSON.stringify({ prompt: 'white hair, red eyes, moonlit room', uc: 'bad anatomy', seed: 88 }),
    })

    const metadata = extractImageMetadata(buffer, 'image/png')

    expect(metadata.format).toBe('novelai')
    expect(metadata.positivePrompt).toBe('white hair, red eyes, moonlit room')
    expect(metadata.negativePrompt).toBe('bad anatomy')
    expect(metadata.tags).toEqual(expect.arrayContaining(['white hair', 'red eyes', 'moonlit room']))
    expect(metadata.settings.seed).toBe(88)
  })

  it('summarizes ComfyUI workflow prompt text', () => {
    const workflow = {
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: { text: 'same heroine, school rooftop, sunset' },
      },
      '4': {
        class_type: 'KSampler',
        inputs: { seed: 99, steps: 22, cfg: 6 },
      },
    }

    const metadata = parseGenerationMetadataText({ workflow: JSON.stringify(workflow) })

    expect(metadata.format).toBe('comfyui')
    expect(metadata.positivePrompt).toContain('same heroine')
    expect(metadata.workflowSummary).toContain('CLIPTextEncode: same heroine, school rooftop, sunset')
    expect(metadata.settings.seed).toBe(99)
  })

  it('extracts A1111 parameters from JPEG EXIF UserComment stored as binary UTF-16', () => {
    const parameters =
      'solo girl, beach, golden hour\n' +
      'Negative prompt: blurry\n' +
      'Steps: 30, Sampler: Euler a, CFG scale: 6, Seed: 7'

    const metadata = extractImageMetadata(jpegWithExifUserComment(parameters), 'image/jpeg')

    expect(metadata.format).toBe('a1111')
    expect(metadata.positivePrompt).toContain('solo girl')
    expect(metadata.negativePrompt).toBe('blurry')
    expect(metadata.tags).toContain('golden hour')
    expect(() => generationMetadataSchema.parse(metadata)).not.toThrow()
  })

  it('extracts A1111 parameters from WebP EXIF chunks', () => {
    const parameters =
      'knight, castle gate, rain\n' +
      'Negative prompt: low quality\n' +
      'Steps: 24, Sampler: Euler a, CFG scale: 7, Seed: 21'

    const metadata = extractImageMetadata(webpWithExifUserComment(parameters), 'image/webp')

    expect(metadata.format).toBe('a1111')
    expect(metadata.positivePrompt).toContain('castle gate')
    expect(metadata.negativePrompt).toBe('low quality')
    expect(() => generationMetadataSchema.parse(metadata)).not.toThrow()
  })

  it('clamps long ComfyUI workflow summaries to the shared schema limits', () => {
    const longPrompt = `masterpiece, ${'very detailed scenery, '.repeat(100)}sunset`
    const workflow = {
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: { text: longPrompt },
      },
    }

    const metadata = parseGenerationMetadataText({ workflow: JSON.stringify(workflow) })

    expect(metadata.format).toBe('comfyui')
    expect(metadata.workflowSummary?.[0].length).toBeLessThanOrEqual(1000)
    expect(() => generationMetadataSchema.parse(metadata)).not.toThrow()
  })
})
