import type { FormEvent } from 'react'
import { ImagePlus } from 'lucide-react'
import type { ProjectDetail, StoryBible } from '../shared/types'
import { useI18n } from '../i18n/context'

export function StoryPanel(props: {
  detail: ProjectDetail | null
  userBrief: string
  setUserBrief: (value: string) => void
  r18Enabled: boolean
  setR18Enabled: (value: boolean) => void
  pixivUrl: string
  setPixivUrl: (value: string) => void
  onPixivImport: (event: FormEvent) => void
  onStoryBibleChange: (storyBible: StoryBible) => void
  onStoryBibleCommit: (storyBible: StoryBible) => void
  disabled: boolean
}) {
  const { t } = useI18n()
  const story = props.detail?.project.storyBible
  const updateStory = (patch: Partial<StoryBible>) => {
    if (!story) return
    props.onStoryBibleChange({ ...story, ...patch })
  }
  const commitStory = (patch: Partial<StoryBible>) => {
    if (!story) return
    props.onStoryBibleCommit({ ...story, ...patch })
  }
  const updateBeat = (pageIndex: number, patch: Partial<StoryBible['pageBeats'][number]>) => {
    if (!story) return
    props.onStoryBibleChange({
      ...story,
      pageBeats: story.pageBeats.map((beat) => (beat.pageIndex === pageIndex ? { ...beat, ...patch } : beat)),
    })
  }
  const commitBeat = (pageIndex: number, patch: Partial<StoryBible['pageBeats'][number]>) => {
    if (!story) return
    props.onStoryBibleCommit({
      ...story,
      pageBeats: story.pageBeats.map((beat) => (beat.pageIndex === pageIndex ? { ...beat, ...patch } : beat)),
    })
  }

  return (
    <div className="inspector-body">
      <form className="pixiv-form" onSubmit={props.onPixivImport}>
        <label>
          {t('story.pixivUrlLabel')}
          <input value={props.pixivUrl} onChange={(event) => props.setPixivUrl(event.target.value)} placeholder={t('story.pixivPlaceholder')} />
        </label>
        <button type="submit" className="secondary-button" disabled={props.disabled}>
          <ImagePlus size={15} />
          {t('toolbar.importPixiv')}
        </button>
      </form>

      <label className="field-block">
        {t('story.userBrief')}
        <textarea value={props.userBrief} onChange={(event) => props.setUserBrief(event.target.value)} rows={5} placeholder={t('story.userBriefPlaceholder')} />
      </label>

      <label className="toggle-row danger">
        <input type="checkbox" checked={props.r18Enabled} onChange={(event) => props.setR18Enabled(event.target.checked)} />
        <span>{t('story.r18Local')}</span>
      </label>

      {story ? (
        <div className="edit-form story-editor">
          <label>
            {t('story.synopsis')}
            <textarea
              value={story.synopsis}
              rows={4}
              data-testid="story-synopsis-input"
              onChange={(event) => updateStory({ synopsis: event.target.value })}
              onBlur={(event) => commitStory({ synopsis: event.target.value })}
            />
          </label>
          <label>
            {t('story.tone')}
            <textarea
              value={story.tone}
              rows={3}
              data-testid="story-tone-input"
              onChange={(event) => updateStory({ tone: event.target.value })}
              onBlur={(event) => commitStory({ tone: event.target.value })}
            />
          </label>
          <label>
            {t('story.stylePrompt')}
            <textarea
              value={story.stylePrompt || ''}
              rows={3}
              data-testid="story-style-prompt-input"
              placeholder={t('story.stylePromptPlaceholder')}
              onChange={(event) => updateStory({ stylePrompt: event.target.value })}
              onBlur={(event) => commitStory({ stylePrompt: event.target.value })}
            />
          </label>
          <label className="toggle-row danger">
            <input
              type="checkbox"
              checked={story.r18Enabled}
              onChange={(event) => {
                const next = { ...story, r18Enabled: event.target.checked }
                props.onStoryBibleChange(next)
                props.onStoryBibleCommit(next)
              }}
            />
            <span>{t('story.bibleR18')}</span>
          </label>
          <div className="beat-list">
            {story.pageBeats.map((beat) => (
              <div key={`${beat.pageIndex}-${beat.summary}`} className="beat-row">
                <strong>P{beat.pageIndex + 1}</strong>
                <label>
                  {t('story.summary')}
                  <textarea
                    value={beat.summary}
                    rows={3}
                    data-testid="story-beat-summary-input"
                    onChange={(event) => updateBeat(beat.pageIndex, { summary: event.target.value })}
                    onBlur={(event) => commitBeat(beat.pageIndex, { summary: event.target.value })}
                  />
                </label>
                <label>
                  {t('story.intent')}
                  <textarea
                    value={beat.intent}
                    rows={2}
                    onChange={(event) => updateBeat(beat.pageIndex, { intent: event.target.value })}
                    onBlur={(event) => commitBeat(beat.pageIndex, { intent: event.target.value })}
                  />
                </label>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="empty-text">{t('story.empty')}</p>
      )}
    </div>
  )
}
