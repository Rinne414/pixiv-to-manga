import type { MessageKey } from '../i18n/messages'
import type { BubbleStyle, PageStatus, ProjectMode, ProjectSource } from '../shared/types'

export const bubbleStyles: BubbleStyle[] = ['speech', 'soft', 'thought', 'caption', 'sfx']

export const modeKeys: Record<ProjectMode, MessageKey> = {
  story: 'mode.story',
  translation: 'mode.translation',
}

export const sourceKeys: Record<ProjectSource, MessageKey> = {
  pixiv: 'source.pixiv',
  local: 'source.local',
  mixed: 'source.mixed',
  sample: 'source.sample',
}

export const pageStatusKeys: Record<PageStatus, MessageKey> = {
  ready: 'pageStatus.ready',
  analyzing: 'pageStatus.analyzing',
  generating: 'pageStatus.generating',
  complete: 'pageStatus.complete',
  error: 'pageStatus.error',
}

export const bubbleStyleKeys: Record<BubbleStyle, MessageKey> = {
  speech: 'bubble.speech',
  soft: 'bubble.soft',
  thought: 'bubble.thought',
  caption: 'bubble.caption',
  sfx: 'bubble.sfx',
}
