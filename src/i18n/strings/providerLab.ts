import type { LocalizedText } from '../types'

/**
 * Strings for the Provider Lab panel (src/ProviderLabPanel.tsx).
 * IMPORTANT: `en` values are asserted verbatim by the Playwright E2E suite —
 * do not reword them without updating e2e/*.spec.ts.
 */
export const providerLabStrings = {
  // Section heading
  'providerLab.title': { en: 'Provider Lab', 'zh-TW': 'Provider 實驗室' },
  'providerLab.subtitle': {
    en: 'Profiles, capability checks, and NSFW route signals.',
    'zh-TW': 'Provider 設定檔、能力檢測與 NSFW 路由訊號。',
  },
  'providerLab.refresh': { en: 'Refresh', 'zh-TW': '重新整理' },

  // Provider list
  'providerLab.providers': { en: 'Providers', 'zh-TW': 'Provider 清單' },
  'providerLab.providerRowMeta': { en: '{kind} / {keyState}', 'zh-TW': '{kind} / {keyState}' },
  'providerLab.kindLocal': { en: 'Local', 'zh-TW': '本機' },
  'providerLab.kindExternal': { en: 'External', 'zh-TW': '外部' },
  'providerLab.keySaved': { en: 'key saved', 'zh-TW': '已存金鑰' },
  'providerLab.noKey': { en: 'no key', 'zh-TW': '無金鑰' },
  'providerLab.emptyProviders': { en: 'No provider profiles yet.', 'zh-TW': '尚無 Provider 設定檔。' },

  // Provider form
  'providerLab.editProvider': { en: 'Edit provider', 'zh-TW': '編輯 Provider' },
  'providerLab.createProvider': { en: 'Create provider', 'zh-TW': '新增 Provider' },
  'providerLab.name': { en: 'Name', 'zh-TW': '名稱' },
  'providerLab.namePlaceholder': {
    en: 'OpenAI, LM Studio, OpenRouter...',
    'zh-TW': 'OpenAI、LM Studio、OpenRouter...',
  },
  'providerLab.baseUrl': { en: 'Base URL', 'zh-TW': 'Base URL' },
  'providerLab.baseUrlPlaceholder': {
    en: 'https://api.openai.com/v1 or http://127.0.0.1:11434/v1',
    'zh-TW': 'https://api.openai.com/v1 或 http://127.0.0.1:11434/v1',
  },
  'providerLab.defaultModel': { en: 'Default model', 'zh-TW': '預設模型' },
  'providerLab.defaultModelPlaceholder': { en: 'gpt-4.1-mini', 'zh-TW': 'gpt-4.1-mini' },
  'providerLab.apiKey': { en: 'API key', 'zh-TW': 'API key' },
  'providerLab.apiKeyPlaceholderSaved': {
    en: 'Saved; enter a new key to replace',
    'zh-TW': '已儲存；輸入新金鑰以取代',
  },
  'providerLab.apiKeyPlaceholderNew': { en: 'Write-only key', 'zh-TW': '僅寫入金鑰' },
  'providerLab.localProvider': { en: 'Local provider', 'zh-TW': '本機 Provider' },
  'providerLab.localKeyHint': {
    en: 'Local providers (Ollama, LM Studio) need no API key — leave it empty.',
    'zh-TW': '本機 provider(如 Ollama、LM Studio)不需要 API key，留空即可。',
  },
  'providerLab.save': { en: 'Save', 'zh-TW': '儲存' },
  'providerLab.new': { en: 'New', 'zh-TW': '新增' },
  'providerLab.delete': { en: 'Delete', 'zh-TW': '刪除' },

  // Model Discovery
  'providerLab.modelDiscovery': { en: 'Model Discovery', 'zh-TW': '模型探索' },
  'providerLab.modelDiscoverySubtitle': {
    en: 'Capability status comes from backend discovery, tests, or user confirmation.',
    'zh-TW': '能力狀態來自後端探索、測試或使用者確認。',
  },
  'providerLab.discover': { en: 'Discover', 'zh-TW': '探索' },
  'providerLab.emptyModels': {
    en: 'Select a provider and run discovery when the backend endpoint is available.',
    'zh-TW': '選擇一個 Provider，並在後端端點可用時執行探索。',
  },

  // Capability status labels (model rows) — fall back to the raw value when unmapped
  'providerLab.statusUnknown': { en: 'unknown', 'zh-TW': '未知' },
  'providerLab.statusDetected': { en: 'detected', 'zh-TW': '已偵測' },
  'providerLab.statusUserConfirmed': { en: 'user-confirmed', 'zh-TW': '使用者確認' },
  'providerLab.statusUnsupported': { en: 'unsupported', 'zh-TW': '不支援' },

  // Capability Matrix
  'providerLab.capabilityMatrix': { en: 'Capability Matrix', 'zh-TW': '能力矩陣' },
  'providerLab.noModelSelected': { en: 'No model selected', 'zh-TW': '尚未選擇模型' },
  'providerLab.saveFlags': { en: 'Save flags', 'zh-TW': '儲存旗標' },

  // Capability flag labels
  'providerLab.capVision': { en: 'Vision', 'zh-TW': 'Vision' },
  'providerLab.capImageGeneration': { en: 'Image generation', 'zh-TW': '圖片生成' },
  'providerLab.capStreaming': { en: 'Streaming', 'zh-TW': '串流' },
  'providerLab.capJsonSchema': { en: 'JSON Schema', 'zh-TW': 'JSON Schema' },
  'providerLab.capAdultInput': { en: 'Adult input', 'zh-TW': '成人內容輸入' },
  'providerLab.capAdultGeneration': { en: 'Adult generation', 'zh-TW': '成人內容生成' },

  // NSFW route hints
  'providerLab.hintNoVision': {
    en: 'Images are blocked because this model is not marked Vision-capable.',
    'zh-TW': '因為此模型未標記為支援 Vision，圖片將被封鎖。',
  },
  'providerLab.hintNoImageGeneration': {
    en: 'Story continuation image generation is blocked until image generation is enabled.',
    'zh-TW': '在啟用圖片生成之前，故事續作的圖片生成將被封鎖。',
  },
  'providerLab.hintNoAdultInput': {
    en: 'R-18 image input is blocked for external providers unless adult input is explicitly allowed.',
    'zh-TW': '除非明確允許成人內容輸入，否則外部 Provider 的 R-18 圖片輸入將被封鎖。',
  },
  'providerLab.hintNoAdultGeneration': {
    en: 'R-18 generation is blocked until adult generation is explicitly allowed.',
    'zh-TW': '在明確允許成人內容生成之前，R-18 生成將被封鎖。',
  },
  'providerLab.hintDefault': {
    en: 'Route can accept image and R-18 requests only when the user enables R-18 for that job.',
    'zh-TW': '只有在使用者為該任務啟用 R-18 時，路由才會接受圖片與 R-18 請求。',
  },

  // Test Controls
  'providerLab.testControls': { en: 'Test Controls', 'zh-TW': '測試控制' },
  'providerLab.testControlsSubtitle': {
    en: 'Runs through the local backend and returns redacted traces.',
    'zh-TW': '透過本機後端執行，並回傳已遮蔽的追蹤紀錄。',
  },
  'providerLab.runTest': { en: 'Run test', 'zh-TW': '執行測試' },

  // Test toggle / result kind labels — en MUST stay lowercase for getByLabel()
  'providerLab.testText': { en: 'text', 'zh-TW': '文字' },
  'providerLab.testVision': { en: 'vision', 'zh-TW': '視覺' },
  'providerLab.testJson': { en: 'json', 'zh-TW': 'JSON' },
  'providerLab.testStreaming': { en: 'streaming', 'zh-TW': '串流' },
  'providerLab.emptyTestResult': { en: 'No test result yet.', 'zh-TW': '尚無測試結果。' },

  // Test readout
  'providerLab.pass': { en: 'Pass', 'zh-TW': '通過' },
  'providerLab.fail': { en: 'Fail', 'zh-TW': '失敗' },
  'providerLab.latency': { en: '{ms} ms', 'zh-TW': '{ms} 毫秒' },
  'providerLab.resultPassed': { en: 'passed', 'zh-TW': '通過' },
  'providerLab.resultFailed': { en: 'failed', 'zh-TW': '失敗' },
  'providerLab.redactedTrace': { en: 'Redacted trace', 'zh-TW': '已遮蔽追蹤紀錄' },
  'providerLab.noTrace': { en: 'No trace returned.', 'zh-TW': '沒有回傳任何追蹤紀錄。' },

  // Busy labels (drive the per-button spinner via equality checks; kept translatable)
  'providerLab.loadingLab': { en: 'Loading Provider Lab', 'zh-TW': '載入 Provider 實驗室中' },
  'providerLab.creatingProvider': { en: 'Creating provider', 'zh-TW': '建立 Provider 中' },
  'providerLab.updatingProvider': { en: 'Updating provider', 'zh-TW': '更新 Provider 中' },
  'providerLab.deletingProvider': { en: 'Deleting provider', 'zh-TW': '刪除 Provider 中' },
  'providerLab.discoveringModels': { en: 'Discovering models', 'zh-TW': '探索模型中' },
  'providerLab.savingCapabilities': { en: 'Saving capabilities', 'zh-TW': '儲存能力設定中' },
  'providerLab.testingProvider': { en: 'Testing provider', 'zh-TW': '測試 Provider 中' },

  // Errors thrown/handled inside the component
  'providerLab.errorRequiredFields': {
    en: 'Provider name, base URL, and default model are required.',
    'zh-TW': 'Provider 名稱、Base URL 與預設模型為必填。',
  },
  'providerLab.errorCapabilityRecord': {
    en: 'Capability save requires a backend capability record from discovery or test first.',
    'zh-TW': '儲存能力設定前，需先透過探索或測試取得後端能力紀錄。',
  },
  'providerLab.unknownError': { en: 'Unknown error', 'zh-TW': '未知錯誤' },
} satisfies Record<string, LocalizedText>
