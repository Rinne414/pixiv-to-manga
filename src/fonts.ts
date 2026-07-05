import type { MessageKey } from './i18n/messages'

/** Fallback stack used by both the whiteboard and PNG export when a character has no font. */
export const DEFAULT_DIALOGUE_FONT = '"Noto Serif SC", "Songti SC", SimSun, serif'

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
