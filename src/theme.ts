import { useCallback, useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark'

// Duplicated as a literal in index.html's pre-paint inline script — keep both in sync.
const THEME_STORAGE_KEY = 'ptm-theme'

export function detectTheme(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') {
      return saved
    }
  } catch {
    // Storage may be unavailable; fall back to the OS preference.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Applies the theme to <html data-theme> and persists explicit user choices. */
export function useTheme(): { theme: ThemePreference; toggleTheme: () => void } {
  const [theme, setTheme] = useState<ThemePreference>(detectTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark'
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next)
      } catch {
        // Theme preference simply resets next session when storage is unavailable.
      }
      return next
    })
  }, [])

  return { theme, toggleTheme }
}
