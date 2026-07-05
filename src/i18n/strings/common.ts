import type { LocalizedText } from '../types'

/**
 * Strings for the app chrome and the Manga Studio workspace (App.tsx).
 * IMPORTANT: `en` values are asserted verbatim by the Playwright E2E suite —
 * do not reword them without updating e2e/*.spec.ts.
 */
export const commonStrings = {
  // Header / chrome
  'header.appSubtitle': { en: 'Local creative workspace', 'zh-TW': '本機創作工作區' },
  'header.projectSummary': { en: '{pages} pages / {mode}', 'zh-TW': '{pages} 頁 / {mode}' },
  'header.entryStudio': { en: 'Manga Studio', 'zh-TW': '漫畫工作室' },
  'header.entryContinue': { en: 'Story Continue', 'zh-TW': '故事續作' },
  'header.workspaceEntries': { en: 'Workspace entries', 'zh-TW': '工作區入口' },
  'header.language': { en: 'Language', 'zh-TW': '語言' },
  'header.themeToDark': { en: 'Switch to dark mode', 'zh-TW': '切換至深色模式' },
  'header.themeToLight': { en: 'Switch to light mode', 'zh-TW': '切換至淺色模式' },
  'header.localImageFiles': { en: 'Local image files', 'zh-TW': '本機圖片檔案' },
  'header.projectBackupZip': { en: 'Project backup ZIP', 'zh-TW': '專案備份 ZIP' },

  // Toolbar
  'toolbar.importPixiv': { en: 'Import Pixiv', 'zh-TW': '匯入 Pixiv' },
  'toolbar.localImages': { en: 'Local Images', 'zh-TW': '本機圖片' },
  'toolbar.analyzeStory': { en: 'Analyze Story', 'zh-TW': '分析故事' },
  'toolbar.generatePage': { en: 'Generate Page', 'zh-TW': '生成本頁' },
  'toolbar.generateAll': { en: 'Generate All', 'zh-TW': '全部生成' },
  'toolbar.cancel': { en: 'Cancel', 'zh-TW': '取消' },
  'toolbar.exportZip': { en: 'Export ZIP', 'zh-TW': '匯出 ZIP' },
  'toolbar.exportBackup': { en: 'Export Backup', 'zh-TW': '匯出備份' },
  'toolbar.restoreBackup': { en: 'Restore Backup', 'zh-TW': '還原備份' },

  'status.ready': { en: 'Ready', 'zh-TW': '待命' },

  // Enum-ish display values
  'mode.story': { en: 'Story', 'zh-TW': '故事' },
  'mode.translation': { en: 'Translation', 'zh-TW': '翻譯' },
  'source.pixiv': { en: 'pixiv', 'zh-TW': 'Pixiv' },
  'source.local': { en: 'local', 'zh-TW': '本機' },
  'source.mixed': { en: 'mixed', 'zh-TW': '混合' },
  'source.sample': { en: 'sample', 'zh-TW': '範例' },
  'pageStatus.ready': { en: 'ready', 'zh-TW': '就緒' },
  'pageStatus.analyzing': { en: 'analyzing', 'zh-TW': '分析中' },
  'pageStatus.generating': { en: 'generating', 'zh-TW': '生成中' },
  'pageStatus.complete': { en: 'complete', 'zh-TW': '完成' },
  'pageStatus.error': { en: 'error', 'zh-TW': '錯誤' },

  // Left rail
  'studio.newProject': { en: 'New Project', 'zh-TW': '新增專案' },
  'studio.projectTitle': { en: 'Project title', 'zh-TW': '專案標題' },
  'studio.untitledManga': { en: 'Untitled Manga', 'zh-TW': '未命名漫畫' },
  'studio.create': { en: 'Create', 'zh-TW': '建立' },
  'studio.projects': { en: 'Projects', 'zh-TW': '專案' },
  'studio.pages': { en: 'Pages', 'zh-TW': '頁面' },
  'studio.pageLabel': { en: 'Page {n}', 'zh-TW': '第 {n} 頁' },
  'studio.pageThumbSummary': { en: '{count} lines / {status}', 'zh-TW': '{count} 句 / {status}' },
  'studio.projectRowSummary': { en: '{source} / {mode}', 'zh-TW': '{source} / {mode}' },
  'studio.emptyCanvas': { en: 'Import pages to start.', 'zh-TW': '先匯入頁面即可開始。' },

  // Whiteboard controls
  'whiteboard.zoomIn': { en: 'Zoom in', 'zh-TW': '放大' },
  'whiteboard.zoomOut': { en: 'Zoom out', 'zh-TW': '縮小' },
  'whiteboard.fitPage': { en: 'Fit page', 'zh-TW': '適配頁面' },
  'whiteboard.actualSize': { en: 'Actual size (100%)', 'zh-TW': '原始大小 (100%)' },
  'whiteboard.hint': { en: 'Drag background to pan · scroll to zoom', 'zh-TW': '拖曳背景平移 · 滾輪縮放' },

  // Inspector tabs
  'tab.story': { en: 'Story Bible', 'zh-TW': '故事聖經' },
  'tab.characters': { en: 'Characters', 'zh-TW': '角色' },
  'tab.dialogue': { en: 'Dialogue', 'zh-TW': '對白' },
  'tab.layout': { en: 'Layout', 'zh-TW': '版面' },
  'tab.settings': { en: 'Settings', 'zh-TW': '設定' },
  'tab.inspectorPanels': { en: 'Inspector panels', 'zh-TW': '檢視面板' },

  // Story panel
  'story.pixivUrlLabel': { en: 'Pixiv Artwork URL / ID', 'zh-TW': 'Pixiv 作品網址 / ID' },
  'story.pixivPlaceholder': { en: 'https://www.pixiv.net/artworks/...', 'zh-TW': 'https://www.pixiv.net/artworks/...' },
  'story.userBrief': { en: 'User Brief', 'zh-TW': '創作指示' },
  'story.userBriefPlaceholder': {
    en: 'Story direction, character relationships, tone, or constraints...',
    'zh-TW': '故事方向、角色關係、語氣或限制...',
  },
  'story.r18Local': { en: 'R-18 enabled locally', 'zh-TW': '本機啟用 R-18' },
  'story.synopsis': { en: 'Synopsis', 'zh-TW': '大綱' },
  'story.tone': { en: 'Tone', 'zh-TW': '基調' },
  'story.bibleR18': { en: 'Story Bible R-18', 'zh-TW': '故事聖經 R-18' },
  'story.summary': { en: 'Summary', 'zh-TW': '摘要' },
  'story.intent': { en: 'Intent', 'zh-TW': '意圖' },
  'story.empty': { en: 'Run Analyze Story to create the Story Bible.', 'zh-TW': '執行「分析故事」以建立故事聖經。' },

  // Characters panel
  'character.name': { en: 'Name', 'zh-TW': '名字' },
  'character.description': { en: 'Description', 'zh-TW': '描述' },
  'character.voice': { en: 'Voice', 'zh-TW': '語氣' },
  'character.color': { en: 'Color', 'zh-TW': '顏色' },
  'character.bubble': { en: 'Bubble', 'zh-TW': '氣泡' },
  'character.empty': { en: 'No characters yet.', 'zh-TW': '尚無角色。' },
  'bubble.speech': { en: 'speech', 'zh-TW': '對話' },
  'bubble.soft': { en: 'soft', 'zh-TW': '柔和' },
  'bubble.thought': { en: 'thought', 'zh-TW': '思考' },
  'bubble.caption': { en: 'caption', 'zh-TW': '旁白' },

  // Dialogue panel
  'dialogue.text': { en: 'Text', 'zh-TW': '文字' },
  'dialogue.character': { en: 'Character', 'zh-TW': '角色名' },
  'dialogue.lock': { en: 'Lock', 'zh-TW': '鎖定' },
  'dialogue.unlock': { en: 'Unlock', 'zh-TW': '解鎖' },
  'dialogue.empty': { en: 'Generate or select dialogue.', 'zh-TW': '先生成或選擇對白。' },

  // Layout panel
  'layout.textDensity': { en: 'Text density', 'zh-TW': '文字密度' },
  'layout.canvasZoom': { en: 'Canvas zoom', 'zh-TW': '畫布縮放' },
  'layout.avoidOverlap': { en: 'Avoid overlap', 'zh-TW': '自動避讓' },
  'layout.x': { en: 'X', 'zh-TW': 'X' },
  'layout.y': { en: 'Y', 'zh-TW': 'Y' },
  'layout.scale': { en: 'Scale', 'zh-TW': '縮放' },
  'layout.rotation': { en: 'Rotation', 'zh-TW': '旋轉' },

  // Settings panel
  'settings.keychainOk': { en: 'System keychain available', 'zh-TW': '系統金鑰圈可用' },
  'settings.keychainBlocked': { en: 'System keychain blocked', 'zh-TW': '系統金鑰圈不可用' },
  'settings.secretSummary': { en: 'API key: {apiKey} / Pixiv cookie: {cookie}', 'zh-TW': 'API key：{apiKey} / Pixiv cookie：{cookie}' },
  'settings.saved': { en: 'saved', 'zh-TW': '已儲存' },
  'settings.notSaved': { en: 'not saved', 'zh-TW': '未儲存' },
  'settings.baseUrl': { en: 'OpenAI-compatible Base URL', 'zh-TW': 'OpenAI 相容 Base URL' },
  'settings.baseUrlPlaceholder': { en: 'https://api.openai.com/v1', 'zh-TW': 'https://api.openai.com/v1' },
  'settings.model': { en: 'Model', 'zh-TW': '模型' },
  'settings.modelPlaceholder': { en: 'gpt-4.1-mini', 'zh-TW': 'gpt-4.1-mini' },
  'settings.apiKey': { en: 'API Key', 'zh-TW': 'API Key' },
  'settings.pixivCookie': { en: 'Pixiv Cookie', 'zh-TW': 'Pixiv Cookie' },
  'settings.savedInKeychain': { en: 'Saved in keychain', 'zh-TW': '已存於系統金鑰圈' },
  'settings.notSavedPlaceholder': { en: 'Not saved', 'zh-TW': '未儲存' },
  'settings.cookiePlaceholder': { en: 'Required for private/R-18 imports', 'zh-TW': '私人或 R-18 匯入時需要' },
  'settings.save': { en: 'Save Settings', 'zh-TW': '儲存設定' },

  // Log panel
  'logPanel.title': { en: 'Generation Log', 'zh-TW': '生成日誌' },
  'logPanel.empty': { en: 'No events yet.', 'zh-TW': '尚無事件。' },

  // Log messages / busy labels
  'log.studioReady': { en: 'Studio ready. Local database loaded.', 'zh-TW': '工作室就緒，本機資料庫已載入。' },
  'log.creatingProject': { en: 'Creating project', 'zh-TW': '建立專案中' },
  'log.projectCreated': { en: 'Project created.', 'zh-TW': '專案已建立。' },
  'log.importingLocal': { en: 'Importing local images', 'zh-TW': '匯入本機圖片中' },
  'log.imagesImported': { en: '{count} image(s) imported.', 'zh-TW': '已匯入 {count} 張圖片。' },
  'log.restoringBackup': { en: 'Restoring project backup', 'zh-TW': '還原專案備份中' },
  'log.backupRestored': { en: 'Backup restored: {title}', 'zh-TW': '備份已還原：{title}' },
  'log.pixivUrlRequired': { en: 'Pixiv artwork URL or ID is required.', 'zh-TW': '需要 Pixiv 作品網址或 ID。' },
  'log.importingPixiv': { en: 'Importing Pixiv artwork', 'zh-TW': '匯入 Pixiv 作品中' },
  'log.pixivImported': { en: 'Pixiv artwork imported.', 'zh-TW': 'Pixiv 作品已匯入。' },
  'log.storyBibleMock': { en: 'Story Bible generated with local mock engine.', 'zh-TW': '已以本機模擬引擎生成故事聖經。' },
  'log.storyBibleGenerated': { en: 'Story Bible generated.', 'zh-TW': '故事聖經已生成。' },
  'log.generatePageLabel': { en: 'Generate Page {n}', 'zh-TW': '生成第 {n} 頁' },
  'log.pageDialogueGenerated': { en: 'Page {n} dialogue generated.', 'zh-TW': '第 {n} 頁對白已生成。' },
  'log.generatingPage': { en: 'Generating page {n}', 'zh-TW': '正在生成第 {n} 頁' },
  'log.allPagesGenerated': { en: 'All pages generated.', 'zh-TW': '全部頁面已生成。' },
  'log.cancellationRequested': { en: 'Cancellation requested.', 'zh-TW': '已要求取消。' },
  'log.jobCancelled': { en: 'Job cancelled.', 'zh-TW': '任務已取消。' },
  'log.resolvingLayout': { en: 'Resolving layout collisions', 'zh-TW': '調整版面避讓中' },
  'log.layoutAdjusted': { en: 'Layout adjusted.', 'zh-TW': '版面已調整。' },
  'log.noPagesToExport': { en: 'No pages to export', 'zh-TW': '沒有可匯出的頁面' },
  'log.exported': { en: 'Exported {file}', 'zh-TW': '已匯出 {file}' },
  'log.exportBackupTask': { en: 'Export project backup', 'zh-TW': '匯出專案備份' },
  'log.backupExported': { en: 'Backup exported {file}', 'zh-TW': '備份已匯出 {file}' },
  'log.savingSettings': { en: 'Saving settings', 'zh-TW': '儲存設定中' },
  'log.settingsSaved': { en: 'Settings saved to system credential store.', 'zh-TW': '設定已儲存至系統憑證庫。' },
  'log.storyBibleSaved': { en: 'Story Bible saved.', 'zh-TW': '故事聖經已儲存。' },
  'log.dialogueSaved': { en: 'Dialogue saved.', 'zh-TW': '對白已儲存。' },
  'log.unknownError': { en: 'Unknown error', 'zh-TW': '未知錯誤' },

  // Raw AI output panel
  'raw.storyBibleTitle': { en: 'Story Bible Raw Output', 'zh-TW': '故事聖經原始輸出' },
  'raw.pageTitle': { en: 'Page {n} Raw Output', 'zh-TW': '第 {n} 頁原始輸出' },
  'raw.aiTitle': { en: 'Raw AI Output', 'zh-TW': 'AI 原始輸出' },
  'raw.original': { en: 'Original output:', 'zh-TW': '原始輸出：' },
  'raw.repair': { en: 'Repair output:', 'zh-TW': '修復輸出：' },
  'raw.schema': { en: 'Expected schema:', 'zh-TW': '預期 schema：' },
} satisfies Record<string, LocalizedText>
