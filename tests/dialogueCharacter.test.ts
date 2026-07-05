import { describe, expect, it } from 'vitest'
import { findDialogueCharacter } from '../src/shared/characters'
import type { Character } from '../src/shared/types'

const characters: Character[] = [
  {
    id: 'char-1',
    projectId: 'project-1',
    name: '夏海',
    description: '',
    voice: '',
    color: '#c9282d',
    fontFamily: '"KaiTi", serif',
    bubbleStyle: 'speech',
  },
  {
    id: 'char-2',
    projectId: 'project-1',
    name: '悠真',
    description: '',
    voice: '',
    color: '#1d5f9f',
    bubbleStyle: 'soft',
  },
]

describe('findDialogueCharacter', () => {
  it('prefers the stable characterId over the display name', () => {
    const match = findDialogueCharacter(characters, { characterId: 'char-2', characterName: '夏海' })

    expect(match?.id).toBe('char-2')
  })

  it('falls back to characterName when the id is missing or dangling', () => {
    expect(findDialogueCharacter(characters, { characterName: '夏海' })?.id).toBe('char-1')
    expect(findDialogueCharacter(characters, { characterId: 'deleted-id', characterName: '悠真' })?.id).toBe('char-2')
  })

  it('returns undefined when neither id nor name matches', () => {
    expect(findDialogueCharacter(characters, { characterId: 'deleted-id', characterName: '路人' })).toBeUndefined()
    expect(findDialogueCharacter(characters, {})).toBeUndefined()
  })
})
