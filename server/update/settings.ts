export interface SettingsStore {
  getSetting(key: string, fallback?: string): string
  upsertSetting(key: string, value: string): void
}

export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

const AUTO_CHECK_KEY = 'update.autoCheck'
const LAST_CHECKED_KEY = 'update.lastCheckedAt'
const LATEST_KEY = 'update.latest'

export interface UpdateSettings {
  autoCheck: boolean
  lastCheckedAt: string | null
}

/** Automatic checking is on unless the user switched it off. */
export function getUpdateSettings(store: SettingsStore): UpdateSettings {
  return {
    autoCheck: store.getSetting(AUTO_CHECK_KEY, 'on') !== 'off',
    lastCheckedAt: store.getSetting(LAST_CHECKED_KEY, '') || null,
  }
}

export function setAutoCheck(store: SettingsStore, enabled: boolean): void {
  store.upsertSetting(AUTO_CHECK_KEY, enabled ? 'on' : 'off')
}

export function recordCheck(store: SettingsStore, checkedAt: string, latestJson: string): void {
  store.upsertSetting(LAST_CHECKED_KEY, checkedAt)
  store.upsertSetting(LATEST_KEY, latestJson)
}

export function readCachedLatest(store: SettingsStore): string {
  return store.getSetting(LATEST_KEY, '')
}

export function shouldAutoCheck(settings: UpdateSettings, now: number): boolean {
  if (!settings.autoCheck) return false
  const last = settings.lastCheckedAt ? Date.parse(settings.lastCheckedAt) : Number.NaN
  return !Number.isFinite(last) || now - last >= AUTO_CHECK_INTERVAL_MS
}
