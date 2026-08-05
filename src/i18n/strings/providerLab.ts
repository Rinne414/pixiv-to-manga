import type { LocalizedText } from '../types'

/**
 * Strings for the Provider Lab panel (src/ProviderLabPanel.tsx).
 * IMPORTANT: `en` values are asserted verbatim by the Playwright E2E suite —
 * do not reword them without updating e2e/*.spec.ts.
 */
export const providerLabStrings = {
  // Section heading
  'providerLab.title': { en: 'Provider Lab', 'zh-TW': 'Provider 實驗室' },
  'providerLab.localTitle': { en: 'Local models', 'zh-TW': '本機模型' },
  'providerLab.externalTitle': { en: 'External model services', 'zh-TW': '外部模型服務' },
  'providerLab.subtitle': {
    en: 'Profiles, capability checks, and NSFW route signals.',
    'zh-TW': 'Provider 設定檔、能力檢測與 NSFW 路由訊號。',
  },
  'providerLab.refresh': { en: 'Refresh', 'zh-TW': '重新整理' },

  // Active engine status card
  'providerLab.activeEngine': { en: 'Current AI engine', 'zh-TW': '目前使用的 AI' },
  'providerLab.activeEngineNone': {
    en: 'No AI engine available',
    'zh-TW': '沒有可用的 AI',
  },
  'providerLab.activeEngineNoneHint': {
    en: 'Add a provider below, or set a Base URL + model in Settings. Local providers (Ollama, LM Studio) need no key.',
    'zh-TW': '請在下方新增 Provider，或在設定填入 Base URL 與模型。本機 Provider（Ollama、LM Studio）不需金鑰。',
  },
  'providerLab.detectLocal': { en: 'Detect local engine', 'zh-TW': '偵測本機模型' },
  'providerLab.detectingLocal': { en: 'Detecting local engines', 'zh-TW': '偵測本機模型中' },
  'providerLab.detectedProviderName': { en: 'Local (auto-detected)', 'zh-TW': '本機（自動偵測）' },
  'providerLab.detectNone': {
    en: 'No local engine found. Start Ollama (e.g. ollama pull qwen3-vl:8b) or LM Studio, then try again.',
    'zh-TW': '找不到本機模型服務。請先啟動 Ollama（如 ollama pull qwen3-vl:8b）或 LM Studio 再試一次。',
  },
  'providerLab.badgeLocal': { en: 'Local', 'zh-TW': '本機' },
  'providerLab.badgeCloud': { en: 'Cloud API', 'zh-TW': '雲端 API' },
  'providerLab.badgeNoKey': { en: 'no key', 'zh-TW': '無金鑰' },
  'providerLab.viaGlobal': { en: 'via global Settings', 'zh-TW': '來自全域設定' },

  // Detected capabilities + model-scoped overrides
  'providerLab.capabilitiesDetected': { en: 'Detected capabilities', 'zh-TW': '已偵測能力' },
  'providerLab.capabilitiesHint': {
    en: 'Detected from provider metadata, model identity, or verified checks.',
    'zh-TW': '根據 Provider 中繼資料、模型識別或驗證檢查自動判定。',
  },
  'providerLab.overrideSection': { en: 'Model capability overrides', 'zh-TW': '模型能力覆寫' },

  // Provider list
  'providerLab.providers': { en: 'Saved connections', 'zh-TW': '已儲存連線' },
  'providerLab.providerRowMeta': { en: '{kind} / {keyState}', 'zh-TW': '{kind} / {keyState}' },
  'providerLab.kindLocal': { en: 'Local', 'zh-TW': '本機' },
  'providerLab.kindExternal': { en: 'External', 'zh-TW': '外部' },
  'providerLab.keySaved': { en: 'key saved', 'zh-TW': '已存金鑰' },
  'providerLab.noKey': { en: 'no key', 'zh-TW': '無金鑰' },
  'providerLab.emptyProviders': { en: 'No provider profiles yet.', 'zh-TW': '尚無 Provider 設定檔。' },
  'providerLab.emptyLocalProviders': { en: 'No local LLM profiles. Detect Ollama/LM Studio or add one below.', 'zh-TW': '尚無本機 LLM。可偵測 Ollama/LM Studio 或在下方新增。' },
  'providerLab.emptyExternalProviders': { en: 'No external API profiles. Add an API gateway or hosted model below.', 'zh-TW': '尚無外部 API。可在下方新增 API Gateway 或託管模型。' },
  'providerLab.externalKeyHint': { en: 'External API profiles require HTTPS and a key stored in the system keychain.', 'zh-TW': '外部 API 需要 HTTPS；金鑰只會存於系統金鑰圈。' },
  'providerLab.localOnly': { en: 'local endpoint', 'zh-TW': '本機端點' },
  'providerLab.routeOutsideWorkspace': { en: 'Current route is outside this workspace', 'zh-TW': '目前生效路由不在此工作區' },
  'providerLab.routeExternalActive': { en: 'External API is active ({model}). Switch to External API to manage it.', 'zh-TW': '目前使用外部 API（{model}）；切換至外部 API 才能管理。' },
  'providerLab.routeLocalActive': { en: 'Local LLM is active ({model}). Switch to Local LLM to manage it.', 'zh-TW': '目前使用本機 LLM（{model}）；切換至本機 LLM 才能管理。' },

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
  'providerLab.new': { en: 'New provider', 'zh-TW': '新增 Provider' },
  'providerLab.edit': { en: 'Edit provider', 'zh-TW': '編輯 Provider' },
  'providerLab.cancel': { en: 'Cancel', 'zh-TW': '取消' },
  'providerLab.delete': { en: 'Delete', 'zh-TW': '刪除' },
  'providerLab.advanced': { en: 'Advanced diagnostics', 'zh-TW': '進階診斷' },

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
  'providerLab.statusSupported': { en: 'supported', 'zh-TW': '支援' },
  'providerLab.statusUserConfirmed': { en: 'user-confirmed', 'zh-TW': '使用者確認' },
  'providerLab.statusUnsupported': { en: 'unsupported', 'zh-TW': '不支援' },

  'providerLab.saveOverrides': { en: 'Save overrides', 'zh-TW': '儲存覆寫' },

  // Capability flag labels
  'providerLab.capVision': { en: 'Vision', 'zh-TW': 'Vision' },
  'providerLab.capImageGeneration': { en: 'Image generation', 'zh-TW': '圖片生成' },
  'providerLab.capStreaming': { en: 'Streaming', 'zh-TW': '串流' },
  'providerLab.capJsonSchema': { en: 'JSON Schema', 'zh-TW': 'JSON Schema' },
  'providerLab.capAdultInput': { en: 'Adult input', 'zh-TW': '成人內容輸入' },
  'providerLab.capAdultGeneration': { en: 'Adult generation', 'zh-TW': '成人內容生成' },

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
  'providerLab.partial': { en: 'Partially verified', 'zh-TW': '部分已確認' },
  'providerLab.unsupportedResult': { en: 'Capability rejected', 'zh-TW': '能力遭明確拒絕' },
  'providerLab.partialSummary': {
    en: '{passed} passed, {unknown} could not be verified',
    'zh-TW': '{passed} 項通過，{unknown} 項無法確認',
  },
  'providerLab.unsupportedSummary': {
    en: '{passed} passed, {unsupported} unsupported',
    'zh-TW': '{passed} 項通過，{unsupported} 項不支援',
  },
  'providerLab.latency': { en: '{ms} ms', 'zh-TW': '{ms} 毫秒' },
  'providerLab.resultPassed': { en: 'passed', 'zh-TW': '通過' },
  'providerLab.resultFailed': { en: 'failed', 'zh-TW': '失敗' },
  'providerLab.resultUnsupported': {
    en: 'The Provider explicitly rejected this capability.',
    'zh-TW': 'Provider 已明確拒絕此能力。',
  },
  'providerLab.resultIndeterminate': {
    en: 'Could not verify. This does not mean the model lacks this capability.',
    'zh-TW': '無法確認；這不代表模型不支援此能力。',
  },
  'providerLab.resultIndeterminateHttp': {
    en: 'Could not verify (HTTP {status}). This does not mean unsupported.',
    'zh-TW': '無法確認（HTTP {status}）；這不代表不支援。',
  },
  'providerLab.redactedTrace': { en: 'Redacted trace', 'zh-TW': '已遮蔽追蹤紀錄' },
  'providerLab.noTrace': { en: 'No trace returned.', 'zh-TW': '沒有回傳任何追蹤紀錄。' },
  'providerLab.connectionFailed': { en: 'Connection failed', 'zh-TW': '連線失敗' },
  'providerLab.connectionAuthError': {
    en: 'Authentication failed. Check the API key and make sure the Base URL points to the API endpoint, not the provider website.',
    'zh-TW': '認證失敗。請檢查 API Key，並確認 Base URL 指向 API 端點，而不是 Provider 網站首頁。',
  },
  'providerLab.connectionEndpointError': {
    en: 'The API endpoint was not found. Check the Base URL and include the required API prefix, such as /v1.',
    'zh-TW': '找不到 API 端點。請檢查 Base URL，並包含服務要求的 API 前綴，例如 /v1。',
  },
  'providerLab.connectionRateLimitError': {
    en: 'The provider rate limit was reached. Wait briefly, then run the test again.',
    'zh-TW': '已達 Provider 速率限制。請稍候再重新測試。',
  },
  'providerLab.connectionUnavailableError': {
    en: 'The provider is temporarily unavailable. Run the test again after the service recovers.',
    'zh-TW': 'Provider 目前無法使用。請在服務恢復後重新測試。',
  },
  'providerLab.connectionNetworkError': {
    en: 'The provider could not be reached. Check the Base URL and network connection.',
    'zh-TW': '無法連上 Provider。請檢查 Base URL 與網路連線。',
  },

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
  'providerLab.unknownError': { en: 'Unknown error', 'zh-TW': '未知錯誤' },
} satisfies Record<string, LocalizedText>
