import { useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { EMOTIONS } from '@shared/emotions'
import { fullNameOf, type Character } from '@shared/types'
import { CardCaption } from '../components/CardCaption'
import { CharacterSortPill } from '../components/CharacterSortPill'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import {
  sortCharacterIds,
  spriteUrl,
  useCharacterStore,
  visibleOrderOf,
  type CharacterSort
} from '../stores/characterStore'
import {
  cardLift,
  dealt,
  gestures,
  hovered,
  lift,
  panelUnderTab,
  press,
  slideInQuick,
  veilIn
} from './motion'
import '../vu_styles/AddCharacter.css'

export interface LoadCharacterModalProps {
  /** charIds already on the roster — listed, and dead with the reason on them. */
  taken: string[]
  onPick: (character: Character) => void
  onClose: () => void
  /** Drawn by the screen that opened this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
}

/**
 * The grid's own stagger, timed for a full screenful to land almost at once with nothing
 * measured or resized first.
 */
const PICK_DEAL = dealt(0, 0.03)

/**
 * The order the picker was last sorted in this launch, which every opening starts on, from
 * whichever screen opens it.
 */
let lastSort: CharacterSort = 'recent'

/** Picks a fully rendered character into an empty New Game slot. */
export function LoadCharacterModal({
  taken,
  onPick,
  onClose,
  theme
}: LoadCharacterModalProps): JSX.Element | null {
  const characters = useCharacterStore((s) => s.characters)
  const allOrder = useCharacterStore((s) => s.order)
  const removedDefaults = useCharacterStore((s) => s.removedDefaults)
  const pregenIds = useCharacterStore((s) => s.pregenIds)
  const [sort, setSort] = useState<CharacterSort>(() => lastSort)
  const order = useMemo(
    () =>
      sortCharacterIds(
        visibleOrderOf({ order: allOrder, removedDefaults }),
        characters,
        pregenIds,
        sort
      ),
    [characters, allOrder, removedDefaults, pregenIds, sort]
  )
  const expressions = useCharacterStore((s) => s.expressions)
  const loading = useCharacterStore((s) => s.loading)

  // Only a character with all seven default expressions can be played, so an unfinished one
  // is not listed at all — the gate is Manage Characters' and not this modal's.
  const finished = order.filter((charId) =>
    EMOTIONS.every((emotion) => expressions[charId]?.[emotion])
  )

  const scroller = useRef<HTMLDivElement | null>(null)
  const [popupHost, setPopupHost] = useState<HTMLElement | null>(null)

  const { host, overlayProps } = useModalShell(onClose)
  if (!host) return null

  // Nothing is drawn while the roster is read: it is one local read, and a line that
  // announces itself and is gone again says less than a panel holding still.
  const waiting = loading && order.length === 0

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
        id="load-character"
        className="vu-sheet vu-pick vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Add a character"
        variants={panelUnderTab}
      >
        <TitleTab>Add a character</TitleTab>

        <div className="vu-pick-scroll">
          <div ref={scroller} className="vu-pick-body">
            {waiting ? null : finished.length === 0 ? (
              <p className="vu-empty">
                No finished characters yet. Make some in Manage characters first.
              </p>
            ) : (
              // Keyed on the order, so a new one deals again; the panel keeps its size.
              <motion.ul key={sort} className="vu-pick-grid" variants={PICK_DEAL}>
                {finished.map((charId) => (
                  <PickCard
                    key={charId}
                    character={characters[charId]}
                    taken={taken.includes(charId)}
                    onPick={() => onPick(characters[charId])}
                  />
                ))}
              </motion.ul>
            )}
          </div>
          <div className="vu-scroll-fade" />
        </div>

        <div className="vu-foot">
          {!waiting && finished.length > 0 && (
            <span className="vu-pick-sort">
              <CharacterSortPill
                id="load-character-sort"
                value={sort}
                popupHost={popupHost}
                onChange={(next) => {
                  lastSort = next
                  setSort(next)
                  scroller.current?.scrollTo({ top: 0 })
                }}
              />
            </span>
          )}
          <motion.button
            id="load-character-close"
            className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
            type="button"
            {...gestures(false, lift, press)}
            onClick={onClose}
          >
            Close
          </motion.button>
        </div>

        {/* The frame the sort's list is placed against, over the grid and taking no pointer of
            its own. */}
        <div className="vu-popups" ref={setPopupHost} />
      </motion.div>
    </motion.div>,
    host
  )
}

/**
 * One character on offer, drawn as the tile she is about to become. Already on the roster, she
 * stays in place, dimmed, with no badge — being in this grid already says so.
 */
function PickCard({
  character,
  taken,
  onPick
}: {
  character: Character
  taken: boolean
  onPick: () => void
}): JSX.Element {
  const face = (
    <>
      {/* Taken, so quiet: no paper layer, and the arch paints its own recessed face. */}
      <div className={`vu-arch vu-pick-arch${taken ? '' : ' vu-paper'}`}>
        <div className="vu-crop vu-card-crop">
          <img className="vu-card-sprite" src={spriteUrl(character.charId, 'neutral')} alt="" />
        </div>
      </div>
      <CardCaption character={character} />
    </>
  )

  return (
    <motion.li
      className={`vu-card vu-pick-card${taken ? ' vu-pick-card--taken' : ''}`}
      variants={slideInQuick}
      {...hovered(taken, cardLift)}
    >
      {/* A card that cannot be picked is a `div`, so it is not a tab stop either and is
          handed no gesture — a dead control the browser would still deliver a hover to. */}
      {taken ? (
        <div className="vu-card-face">{face}</div>
      ) : (
        <motion.button
          className="vu-card-face"
          type="button"
          aria-label={`Add ${fullNameOf(character)} to the roster`}
          whileTap={press}
          onClick={onPick}
        >
          {face}
        </motion.button>
      )}
    </motion.li>
  )
}
