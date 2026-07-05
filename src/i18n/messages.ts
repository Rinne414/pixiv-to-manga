import type { Locale, LocalizedText, MessageParams } from './types'
import { commonStrings } from './strings/common'
import { providerLabStrings } from './strings/providerLab'
import { storyContinueStrings } from './strings/storyContinue'

export const LOCALE_STORAGE_KEY = 'ptm-locale'

const messages = {
  ...commonStrings,
  ...providerLabStrings,
  ...storyContinueStrings,
} satisfies Record<string, LocalizedText>

export type MessageKey = keyof typeof messages

export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const entry: LocalizedText | undefined = messages[key]
  const template = entry?.[locale] ?? entry?.en ?? key
  if (!params) {
    return template
  }
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name]),
  )
}

export function detectLocale(): Locale {
  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    if (saved === 'en' || saved === 'zh-TW') {
      return saved
    }
  } catch {
    // Storage may be unavailable (private mode); fall back to browser language.
  }
  const language = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'en'
  return language.startsWith('zh') ? 'zh-TW' : 'en'
}

export function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Locale preference simply resets next session when storage is unavailable.
  }
}
