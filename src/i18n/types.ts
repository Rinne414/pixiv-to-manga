export type Locale = 'en' | 'zh-TW'

/** Every UI string ships both languages; en doubles as the fallback. */
export interface LocalizedText {
  en: string
  'zh-TW': string
}

export type MessageParams = Record<string, string | number>
