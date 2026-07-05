import type { Character, Dialogue } from './types'

/**
 * Resolve the character that styles a dialogue bubble (font, color).
 * Prefers the stable characterId; falls back to characterName so manually
 * edited dialogues (which only carry a name) still pick up character styling.
 */
export function findDialogueCharacter(
  characters: Character[],
  dialogue: Pick<Dialogue, 'characterId' | 'characterName'>,
): Character | undefined {
  const byId = dialogue.characterId
    ? characters.find((character) => character.id === dialogue.characterId)
    : undefined
  if (byId) {
    return byId
  }
  return dialogue.characterName
    ? characters.find((character) => character.name === dialogue.characterName)
    : undefined
}
