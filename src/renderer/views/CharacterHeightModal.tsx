import { useState, type CSSProperties, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import {
  clampSpriteScale,
  SPRITE_SCALE_MAX,
  SPRITE_SCALE_MIN,
  SPRITE_SCALE_STEP
} from '@shared/spriteScale'
import { shuffle } from '@shared/shuffle'
import { hairColorOf } from '@shared/tags'
import { fullNameOf, type Character } from '@shared/types'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { profileUrl, spriteUrl, useCharacterStore } from '../stores/characterStore'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import '../vu_styles/CharacterHeight.css'

/** The range's own units: whole percentages of full size, as the value beside it reads. */
const PCT_MIN = Math.round(SPRITE_SCALE_MIN * 100)
const PCT_MAX = Math.round(SPRITE_SCALE_MAX * 100)
const PCT_STEP = Math.round(SPRITE_SCALE_STEP * 100)

/**
 * One end of a height: the square that shortens her or heightens her by a step. A roster
 * cluster wears both side by side and the focus row wears them either side of its slider, so
 * this is the one place the end-stop, its label and its dead state are written.
 */
function Stepper({
  character,
  scale,
  step,
  onSet
}: {
  character: Character
  scale: number
  /** -1 shortens her, +1 heightens her. */
  step: -1 | 1
  onSet: (character: Character, scale: number) => void
}): JSX.Element {
  const dead = step < 0 ? scale <= SPRITE_SCALE_MIN : scale >= SPRITE_SCALE_MAX
  return (
    <motion.button
      className="vu-square vu-square--step"
      type="button"
      disabled={dead}
      aria-label={`${step < 0 ? 'Shorten' : 'Heighten'} ${fullNameOf(character)}`}
      {...gestures(dead, quietLift, quietPress)}
      onClick={() => onSet(character, scale + step * SPRITE_SCALE_STEP)}
    >
      {step < 0 ? '−' : '+'}
    </motion.button>
  )
}

export interface CharacterHeightModalProps {
  /** Who is in the lineup, in the order they stand until Sort or Shuffle moves them. */
  roster: Character[]
  theme: 'day' | 'night'
  /**
   * Characters whose height is not the player's to change — the shipped cast. They keep
   * their face and their label and lose the steppers entirely.
   */
  lockedIds?: string[]
  /** The one character this lineup is about (the Edit modal). */
  focus?: string
  /** The two the lineup is measured against, captioned as the ruler they are. */
  anchorIds?: string[]
  /** Hands Shuffle to the caller; without it Shuffle re-orders the roster it was given. */
  onShuffle?: () => void
  onConfirm: (scales: Record<string, number>) => void
}

/**
 * Sets how tall each character stands: a New Game question, reopened over a playthrough or a
 * single character. **Dismissing it is confirming it** — every value here is already the
 * answer, so a click outside, Escape and the button all commit; there is no Cancel.
 */
export function CharacterHeightModal({
  roster,
  theme,
  lockedIds,
  focus,
  anchorIds,
  onShuffle,
  onConfirm
}: CharacterHeightModalProps): JSX.Element | null {
  /* Only the heights the player has touched, resolved against her stored height
     at every read; a full map would go stale when the roster is redrawn. */
  const [scales, setScales] = useState<Record<string, number>>({})
  /* Whoever was adjusted last stands in front of the overlap; in focus mode that is her
     from the first frame, the lineup being about her. */
  const [active, setActive] = useState<string | null>(focus ?? null)
  /* The lineup order, shared by the strip and the rows so a row still points at a position. */
  const [order, setOrder] = useState<string[]>(() => roster.map((c) => c.charId))

  const spriteVersion = useCharacterStore((s) => s.spriteVersion)

  /* A roster swapped out under the modal restarts the ordering, during render so
     no frame shows the new company in the old company's places. */
  const rosterKey = roster.map((c) => c.charId).join(',')
  const [drawnKey, setDrawnKey] = useState(rosterKey)
  if (drawnKey !== rosterKey) {
    setDrawnKey(rosterKey)
    setOrder(roster.map((c) => c.charId))
  }

  const byId = Object.fromEntries(roster.map((c) => [c.charId, c]))
  const lineup = order.map((id) => byId[id]).filter(Boolean)
  const locked = new Set(lockedIds ?? [])

  /* Her label's colour, and a roster's alone: a focus lineup is about one girl among a ruler,
     and the accent chip at her feet is already saying which one she is. */
  const hairOf = (character: Character): string | undefined =>
    focus === undefined ? (hairColorOf(character.baseAppearance) ?? undefined) : undefined

  /** Her height as the lineup stands: what was set here, else what she carries. */
  const scaleOf = (character: Character): number => scales[character.charId] ?? character.height

  /* Which anchor is which is read off the two of them rather than written down: the pair
     is a constant, but their heights are theirs to change on disk. */
  const anchors = (anchorIds ?? []).filter((id) => byId[id])
  const sortedAnchors = [...anchors].sort((a, b) => scaleOf(byId[a]) - scaleOf(byId[b]))
  const rulerOf = (charId: string): string | null => {
    if (sortedAnchors.length < 2) return null
    if (charId === sortedAnchors[0]) return 'shortest'
    if (charId === sortedAnchors[sortedAnchors.length - 1]) return 'tallest'
    return null
  }

  function reshuffle(): void {
    setActive(focus ?? null)
    // The caller's redraw re-orders the strip on its own; doing both would shuffle twice.
    if (onShuffle) onShuffle()
    else setOrder(shuffle)
  }

  /** Orders the lineup shortest to tallest off the current values; ties keep their order. */
  function sortByHeight(): void {
    setOrder((prev) =>
      [...prev].sort((a, b) => (byId[a] ? scaleOf(byId[a]) : 1) - (byId[b] ? scaleOf(byId[b]) : 1))
    )
  }

  /** Sets one character's height, from either the slider or a stepper. */
  function setScale(character: Character, scale: number): void {
    setActive(character.charId)
    setScales((prev) => ({ ...prev, [character.charId]: clampSpriteScale(scale) }))
  }

  /** The whole lineup's answer, built off the roster as it stands right now. */
  const answer = (): Record<string, number> =>
    Object.fromEntries(roster.map((c) => [c.charId, scaleOf(c)]))

  const { host, overlayProps } = useModalShell(() => onConfirm(answer()))
  if (!host) return null

  return createPortal(
    <motion.div
      className="vu-veil"
      data-theme={theme}
      variants={veilIn}
      initial="hidden"
      animate="shown"
      exit="gone"
      {...overlayProps}
    >
      <motion.div
        id="character-heights"
        className="vu-heights vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label={focus === undefined ? 'Adjust Heights' : 'Set height'}
        variants={panelUnderTab}
      >
        <TitleTab>{focus === undefined ? 'Adjust Heights' : 'Set height'}</TitleTab>

        <div
          className={`vu-heights-strip${focus === undefined ? ' vu-heights-strip--roster' : ''}`}
        >
          {lineup.map((character) => {
            const ruler = rulerOf(character.charId)
            const isFocus = character.charId === focus
            return (
              <div
                className={`vu-heights-slot${character.charId === active ? ' vu-heights-slot--front' : ''}`}
                key={character.charId}
                data-hair={hairOf(character)}
                style={{ '--char-scale': scaleOf(character) } as CSSProperties}
              >
                <img
                  className="vu-heights-sprite"
                  src={spriteUrl(character.charId, 'neutral', spriteVersion[character.charId] ?? 0)}
                  alt={fullNameOf(character)}
                />
                <span className={`vu-heights-name${isFocus ? ' vu-heights-name--focus' : ''}`}>
                  <span className="vu-heights-given">{character.firstName || 'Unnamed'}</span>
                  {ruler && <span className="vu-heights-ruler">{ruler}</span>}
                </span>
              </div>
            )
          })}
        </div>

        {focus === undefined ? (
          /* One cluster apiece — her face, her label and the two steps that size her. There
             is no reading beside them: a height is judged against the girl next to her, and
             the strip above is where that judgement is made. */
          <div className="vu-heights-list vu-heights-list--roster">
            {lineup.map((character) => (
              <div
                className="vu-heights-cluster"
                key={character.charId}
                data-hair={hairOf(character)}
              >
                <span className="vu-arch vu-paper vu-heights-arch">
                  <span className="vu-crop">
                    <img
                      className="vu-crop-img"
                      src={profileUrl(character.charId, spriteVersion[character.charId] ?? 0)}
                      alt=""
                    />
                  </span>
                </span>
                <span className="vu-heights-side">
                  <span className="vu-heights-name">
                    <span className="vu-heights-given">{character.firstName || 'Unnamed'}</span>
                  </span>
                  {/* Hers is not the player's to change, so the steps are not there at
                      all rather than dead on every shipped cluster. */}
                  {!locked.has(character.charId) && (
                    <span className="vu-heights-steps">
                      <Stepper
                        character={character}
                        scale={scaleOf(character)}
                        step={-1}
                        onSet={setScale}
                      />
                      <Stepper
                        character={character}
                        scale={scaleOf(character)}
                        step={1}
                        onSet={setScale}
                      />
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          /* One girl, one row: here the slider is the control and the number beside it is the
             reading, since what is being set is her height against a ruler of six. */
          <div className="vu-heights-list">
            {lineup
              .filter((character) => character.charId === focus)
              .map((character) => {
                const scale = scaleOf(character)
                const pct = Math.round(scale * 100)
                const name = fullNameOf(character)

                return (
                  <div className="vu-heights-row" key={character.charId}>
                    <span className="vu-heights-label">{name}</span>
                    <Stepper character={character} scale={scale} step={-1} onSet={setScale} />
                    <input
                      className="vu-range"
                      type="range"
                      min={PCT_MIN}
                      max={PCT_MAX}
                      step={PCT_STEP}
                      value={pct}
                      aria-label={`${name}'s height`}
                      aria-valuetext={`${pct}% of full size`}
                      style={
                        {
                          '--range-fill': `${((pct - PCT_MIN) / (PCT_MAX - PCT_MIN)) * 100}%`
                        } as CSSProperties
                      }
                      onChange={(event) => setScale(character, Number(event.target.value) / 100)}
                    />
                    <Stepper character={character} scale={scale} step={1} onSet={setScale} />
                    <span className="vu-heights-value">{pct}%</span>
                  </div>
                )
              })}
          </div>
        )}

        <div className="vu-foot">
          <motion.button
            id="character-heights-sort"
            className="vu-btn vu-btn--quiet"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={sortByHeight}
          >
            Sort
          </motion.button>
          <motion.button
            id="character-heights-shuffle"
            className="vu-btn vu-btn--quiet"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={reshuffle}
          >
            ↻ Shuffle
          </motion.button>
          <motion.button
            id="character-heights-confirm"
            className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
            type="button"
            {...gestures(false, lift, press)}
            onClick={() => onConfirm(answer())}
          >
            Save
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
