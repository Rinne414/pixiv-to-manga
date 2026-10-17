import type { LocalizedText } from '../types'

/** Strings for the version / update section of Settings and the "new version" badge. */
export const updateStrings = {
  'update.title': { en: 'Version and updates', 'zh-TW': '版本與更新' },
  'update.hint': {
    en: 'Updating replaces the program files only. Your projects, settings, keys and exports stay untouched.',
    'zh-TW': '更新只會替換程式檔案，不會動到你的專案、設定、金鑰與匯出檔案。',
  },
  'update.currentVersion': { en: 'Version {version}', 'zh-TW': '版本 {version}' },
  'update.checkNow': { en: 'Check for updates', 'zh-TW': '檢查更新' },
  'update.checking': { en: 'Checking...', 'zh-TW': '檢查中...' },
  'update.upToDate': { en: 'You are on the latest version.', 'zh-TW': '目前已是最新版本。' },
  'update.available': { en: 'Version {version} is available', 'zh-TW': '有新版本 {version} 可更新' },
  'update.badge': { en: 'Update {version}', 'zh-TW': '有新版 {version}' },
  'update.badgeTitle': { en: 'A new version is available. Open the update details.', 'zh-TW': '有新版本可用，開啟更新資訊。' },
  'update.install': { en: 'Update now', 'zh-TW': '立即更新' },
  'update.whatsNew': { en: 'What changed', 'zh-TW': '更新內容' },
  'update.viewRelease': { en: 'View full release notes', 'zh-TW': '查看完整更新說明' },
  'update.autoCheck': {
    en: 'Check for updates automatically when the app starts (at most once every 6 hours)',
    'zh-TW': '啟動程式時自動檢查更新（最多每 6 小時一次）',
  },
  'update.lastChecked': { en: 'Last checked {time}', 'zh-TW': '上次檢查 {time}' },
  'update.neverChecked': { en: 'Not checked yet', 'zh-TW': '尚未檢查' },
  'update.phaseDownloading': { en: 'Downloading the update... {percent}', 'zh-TW': '下載更新中... {percent}' },
  'update.phaseVerifying': { en: 'Verifying the download (SHA256)...', 'zh-TW': '驗證下載內容 (SHA256)...' },
  'update.phaseExtracting': { en: 'Unpacking the update...', 'zh-TW': '解開更新檔...' },
  'update.phaseRestarting': {
    en: 'Installing and restarting. This page reloads by itself when the studio is back.',
    'zh-TW': '正在安裝並重新啟動。工作室恢復後，此頁面會自動重新載入。',
  },
  'update.sourceInstall': {
    en: 'This copy runs from source or npm, so it cannot update itself. Run git pull (or npm update) and restart.',
    'zh-TW': '這份是從原始碼或 npm 執行的，無法自行更新。請執行 git pull（或 npm update）後重新啟動。',
  },
  'update.noPackage': {
    en: 'Version {version} has no package for this system yet. Try again later or download it from the release page.',
    'zh-TW': '版本 {version} 尚未提供適用本系統的安裝包。請稍後再試，或到發佈頁面下載。',
  },
  'update.checkFailed': { en: 'Could not check for updates: {error}', 'zh-TW': '無法檢查更新：{error}' },
  'update.failed': {
    en: 'Update failed: {error} Nothing was changed.',
    'zh-TW': '更新失敗：{error} 未做任何變更。',
  },
  'update.doneToast': { en: 'Updated to version {version}.', 'zh-TW': '已更新到版本 {version}。' },
  'update.lastFailedToast': {
    en: 'The last update could not be installed ({error}). The previous version was kept.',
    'zh-TW': '上次更新無法安裝（{error}），已保留原本版本。',
  },
  'update.restartTimeout': {
    en: 'The studio did not come back. Start it again with the launcher.',
    'zh-TW': '工作室沒有自動恢復。請用啟動檔重新開啟。',
  },
} satisfies Record<string, LocalizedText>
