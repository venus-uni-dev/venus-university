import { useState, type JSX } from 'react'
import { HEIGHT_ANCHORS } from '@shared/spriteScale'
import { shuffle } from '@shared/shuffle'
import { charKeyOf, type Character } from '@shared/types'
import { useCharacterStore } from '../stores/characterStore'
import { CharacterHeightModal } from './CharacterHeightModal'

/** How many drawn companions stand beside the two anchors and the character. */
const COMPANIONS = 4

export interface SetHeightModalProps {
  /** The character being sized, with the height the Edit modal's form holds, not the disk's. */
  character: Character
  theme: 'day' | 'night'
  onConfirm: (height: number) => void
  onClose: () => void
}

/**
 * The Edit modal's **Set height** lineup: one character measured against six of the
 * shipped cast.
 */
export function SetHeightModal({
  character,
  theme,
  onConfirm,
  onClose
}: SetHeightModalProps): JSX.Element {
  const characters = useCharacterStore((s) => s.characters)
  const pregenIds = useCharacterStore((s) => s.pregenIds)

  /* Drawn from the shipped cast as it is on disk, removed ones included. */
  const shipped = pregenIds
    .map((charId) => characters[charId])
    .filter((c): c is Character => Boolean(c) && c.charId !== character.charId)
  const anchorIds = shipped
    .filter((c) => (HEIGHT_ANCHORS as readonly string[]).includes(charKeyOf(c.firstName, c.lastName)))
    .map((c) => c.charId)
  const poolIds = shipped.map((c) => c.charId).filter((id) => !anchorIds.includes(id))

  /* One arrangement per draw, the character shuffled into it. Held in state: the
     strip must not re-order under a stepper click. */
  const drawLineup = (): string[] =>
    shuffle([character.charId, ...anchorIds, ...shuffle(poolIds).slice(0, COMPANIONS)])
  const [lineupIds, setLineupIds] = useState<string[]>(drawLineup)

  /* Her own record comes from the prop, which carries the form's unsaved height. */
  const roster = lineupIds
    .map((charId) => (charId === character.charId ? character : characters[charId]))
    .filter((c): c is Character => Boolean(c))

  return (
    <CharacterHeightModal
      roster={roster}
      theme={theme}
      focus={character.charId}
      anchorIds={anchorIds}
      lockedIds={lineupIds.filter((id) => id !== character.charId)}
      onShuffle={() => setLineupIds(drawLineup())}
      onConfirm={(scales) => {
        onConfirm(scales[character.charId] ?? character.height)
        onClose()
      }}
    />
  )
}
