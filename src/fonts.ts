import type { MessageKey } from './i18n/messages'
import type { FontAsset } from './shared/types'

/** Fallback stack used by both the whiteboard and PNG export when a character has no font. */
export const DEFAULT_DIALOGUE_FONT = '"Noto Serif SC", "Songti SC", SimSun, serif'

/** CSS font-family value stored on characters for an uploaded font. */
export function fontValueFromFamily(familyName: string): string {
  return `"${familyName}"`
}

/**
 * Registers an uploaded font with the document so the whiteboard and canvas export can
 * use it. Load failures are silent: the library entry still lists the font and
 * rendering falls back through the default stack.
 */
export async function registerCustomFont(font: FontAsset): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) {
    return
  }
  try {
    const face = new FontFace(font.familyName, `url("${font.url}")`)
    const loaded = await face.load()
    document.fonts.add(loaded)
  } catch {
    // Invalid or unsupported font binary; selection still works with fallback rendering.
  }
}

export interface FontPreset {
  /** CSS font-family stack stored on the character; '' means the app default. */
  value: string
  labelKey: MessageKey
}

/**
 * Preset CJK-friendly system font stacks for dialogue lettering.
 * The empty value falls back to the default vertical serif stack used by
 * WhiteboardCanvas.BubbleNode and canvasExport.
 */
export const FONT_PRESETS: FontPreset[] = [
  { value: '', labelKey: 'font.default' },
  { value: '"KaiTi", "DFKai-SB", "BiauKai", "Kaiti SC", "Kaiti TC", serif', labelKey: 'font.kaiti' },
  { value: '"Microsoft JhengHei", "Microsoft YaHei", "PingFang TC", "Noto Sans TC", sans-serif', labelKey: 'font.gothic' },
  { value: '"FangSong", "STFangsong", "FangSong_GB2312", serif', labelKey: 'font.fangsong' },
  { value: '"Yu Mincho", "MS Mincho", "Hiragino Mincho ProN", "Noto Serif JP", serif', labelKey: 'font.mincho' },
]
