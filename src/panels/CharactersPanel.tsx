import { Plus, Trash2 } from 'lucide-react'
import type { BubbleStyle, Character, StoryBible } from '../shared/types'
import { FONT_PRESETS } from '../fonts'
import { useI18n } from '../i18n/context'
import { cryptoId } from '../uiUtils'
import { bubbleStyleKeys, bubbleStyles } from './labels'

const CHARACTER_COLOR_PALETTE = ['#c9282d', '#1d5f9f', '#217a4f', '#7c3aed', '#b45309', '#0f766e']
const MAX_CHARACTERS = 20

export function CharactersPanel(props: {
  storyBible?: StoryBible
  onStoryBibleChange: (storyBible: StoryBible) => void
  onStoryBibleCommit: (storyBible: StoryBible) => void
}) {
  const { t } = useI18n()
  const storyBible = props.storyBible
  const characters = storyBible?.characters || []
  // storyBibleSchema enforces 1..20 characters; mirror those bounds in the UI.
  const canAdd = Boolean(storyBible) && characters.length < MAX_CHARACTERS
  const canDelete = characters.length > 1

  const updateCharacter = (characterId: string, patch: Partial<Character>, commit = false) => {
    if (!storyBible) return
    const next = {
      ...storyBible,
      characters: storyBible.characters.map((character) => (character.id === characterId ? { ...character, ...patch } : character)),
    }
    props.onStoryBibleChange(next)
    if (commit) {
      props.onStoryBibleCommit(next)
    }
  }

  const addCharacter = () => {
    if (!storyBible || !canAdd) return
    const next = {
      ...storyBible,
      characters: [
        ...storyBible.characters,
        {
          id: cryptoId(),
          projectId: storyBible.characters[0]?.projectId || '',
          name: t('character.newName'),
          description: '',
          voice: '',
          color: CHARACTER_COLOR_PALETTE[storyBible.characters.length % CHARACTER_COLOR_PALETTE.length],
          bubbleStyle: 'speech' as BubbleStyle,
        },
      ],
    }
    props.onStoryBibleChange(next)
    props.onStoryBibleCommit(next)
  }

  const deleteCharacter = (characterId: string) => {
    if (!storyBible || !canDelete) return
    const next = {
      ...storyBible,
      characters: storyBible.characters.filter((character) => character.id !== characterId),
    }
    props.onStoryBibleChange(next)
    props.onStoryBibleCommit(next)
  }

  return (
    <div className="inspector-body">
      <button type="button" className="secondary-button" data-testid="character-add" disabled={!canAdd} onClick={addCharacter}>
        <Plus size={15} />
        {t('character.add')}
      </button>
      {characters.length ? (
        characters.map((character) => (
          <div key={character.id} className="character-row character-editor">
            <span className="swatch" style={{ background: character.color }} />
            <div>
              <label>
                {t('character.name')}
                <input
                  value={character.name}
                  data-testid="character-name-input"
                  onChange={(event) => updateCharacter(character.id, { name: event.target.value })}
                  onBlur={(event) => updateCharacter(character.id, { name: event.target.value }, true)}
                />
              </label>
              <label>
                {t('character.description')}
                <textarea
                  value={character.description}
                  rows={3}
                  onChange={(event) => updateCharacter(character.id, { description: event.target.value })}
                  onBlur={(event) => updateCharacter(character.id, { description: event.target.value }, true)}
                />
              </label>
              <label>
                {t('character.voice')}
                <textarea
                  value={character.voice}
                  rows={3}
                  onChange={(event) => updateCharacter(character.id, { voice: event.target.value })}
                  onBlur={(event) => updateCharacter(character.id, { voice: event.target.value }, true)}
                />
              </label>
              <div className="two-col">
                <label>
                  {t('character.color')}
                  <input
                    type="color"
                    value={character.color}
                    onChange={(event) => updateCharacter(character.id, { color: event.target.value })}
                    onBlur={(event) => updateCharacter(character.id, { color: event.target.value }, true)}
                  />
                </label>
                <label>
                  {t('character.bubble')}
                  <select
                    value={character.bubbleStyle}
                    onChange={(event) => updateCharacter(character.id, { bubbleStyle: event.target.value as BubbleStyle }, true)}
                  >
                    {bubbleStyles.map((style) => (
                      <option key={style} value={style}>
                        {t(bubbleStyleKeys[style])}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                {t('character.font')}
                <select
                  value={character.fontFamily || ''}
                  data-testid="character-font-select"
                  onChange={(event) => updateCharacter(character.id, { fontFamily: event.target.value || undefined }, true)}
                >
                  {FONT_PRESETS.map((preset) => (
                    <option key={preset.labelKey} value={preset.value}>
                      {t(preset.labelKey)}
                    </option>
                  ))}
                  {character.fontFamily && !FONT_PRESETS.some((preset) => preset.value === character.fontFamily) ? (
                    <option value={character.fontFamily}>{character.fontFamily}</option>
                  ) : null}
                </select>
              </label>
              <button
                type="button"
                className="secondary-button danger-button"
                data-testid="character-delete"
                disabled={!canDelete}
                onClick={() => deleteCharacter(character.id)}
              >
                <Trash2 size={15} />
                {t('character.delete')}
              </button>
            </div>
          </div>
        ))
      ) : (
        <p className="empty-text">{t('character.empty')}</p>
      )}
    </div>
  )
}
