import type { LocalizedText } from '../types'

/**
 * Strings for the Story Continue workspace (src/StoryContinuePanel.tsx).
 * IMPORTANT: `en` values are asserted verbatim by the Playwright E2E suite —
 * do not reword them without updating e2e/*.spec.ts.
 */
export const storyContinueStrings = {
  // Default prompt seed
  'continue.defaultPrompt': {
    en: 'Continue the story from these references with the same character identity and mood.',
    'zh-TW': '延續這些參考圖的故事，維持相同的角色特徵與氛圍。',
  },

  // Busy labels (also shown in the status line)
  'continue.inspectingRefs': { en: 'Inspecting continuation references', 'zh-TW': '檢視續作參考圖中' },
  'continue.importingPixivRefs': { en: 'Importing continuation Pixiv references', 'zh-TW': '匯入續作 Pixiv 參考圖中' },
  'continue.generatingImage': { en: 'Generating continuation image', 'zh-TW': '生成續作圖像中' },

  // Log messages
  'continue.refsInspected': { en: '{count} reference image(s) inspected.', 'zh-TW': '已檢視 {count} 張參考圖。' },
  'continue.pixivRefsInspected': { en: '{count} Pixiv reference image(s) inspected.', 'zh-TW': '已檢視 {count} 張 Pixiv 參考圖。' },
  'continue.generatedMock': { en: 'Continuation generated with local mock engine.', 'zh-TW': '已以本機模擬引擎生成續作。' },
  'continue.generated': { en: 'Continuation image generated.', 'zh-TW': '續作圖像已生成。' },
  'continue.limitReached': {
    en: 'Reference limit is {max} images. Remove one before adding more.',
    'zh-TW': '參考圖上限為 {max} 張，請先移除一張再新增。',
  },
  'continue.limitSkipped': {
    en: 'Reference limit is {max} images; {skipped} image(s) were skipped.',
    'zh-TW': '參考圖上限為 {max} 張，已略過 {skipped} 張。',
  },

  // References panel
  'continue.localImagesAria': { en: 'Continuation local images', 'zh-TW': '續作本機圖片' },
  'continue.references': { en: 'References', 'zh-TW': '參考圖' },
  'continue.referencesSummary': { en: '{count}/{max} images / {tags} tags', 'zh-TW': '{count}/{max} 張圖片 / {tags} 個標籤' },
  'continue.upload': { en: 'Upload', 'zh-TW': '上傳' },
  'continue.noReferences': { en: 'No references yet.', 'zh-TW': '尚無參考圖。' },

  // Output panel
  'continue.generatedAlt': { en: 'Generated continuation', 'zh-TW': '生成的續作' },
  'continue.localDraft': { en: 'Local draft', 'zh-TW': '本機草稿' },
  'continue.generatedCaption': { en: 'Generated', 'zh-TW': '已生成' },
  'continue.storyContinue': { en: 'Story Continue', 'zh-TW': '故事續作' },

  // Controls panel
  'continue.continueStory': { en: 'Continue Story', 'zh-TW': '續寫故事' },
  'continue.generate': { en: 'Generate', 'zh-TW': '生成' },
  'continue.prompt': { en: 'Prompt', 'zh-TW': '提示詞' },
  'continue.outputs': { en: 'Outputs', 'zh-TW': '輸出數量' },
  'continue.characterConsistency': { en: 'Character consistency', 'zh-TW': '角色一致性' },
  'continue.backgroundConsistency': { en: 'Background consistency', 'zh-TW': '背景一致性' },
  'continue.remove': { en: 'Remove', 'zh-TW': '移除' },
  'continue.tags': { en: 'Tags', 'zh-TW': '標籤' },
  'continue.extractedPrompt': { en: 'Extracted prompt', 'zh-TW': '擷取的提示詞' },
  'continue.addReference': { en: 'Add reference', 'zh-TW': '新增參考圖' },
  'continue.expandedPrompt': { en: 'Expanded prompt', 'zh-TW': '展開的提示詞' },
} satisfies Record<string, LocalizedText>
