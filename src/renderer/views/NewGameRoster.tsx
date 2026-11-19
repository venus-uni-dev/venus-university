import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { firstNameKeyOf } from '@shared/characterRules'
import { EMOTIONS } from '@shared/emotions'
import { shuffle } from '@shared/shuffle'
import { fullNameOf, type Character } from '@shared/types'
import { CardCaption } from '../components/CardCaption'
import { spriteUrl, useCharacterStore, visibleOrderOf } from '../stores/characterStore'
import { CharacterModal } from './CharacterModal'
import { useWarmedImages } from './imagePreload'
import {
  cardLift,
  dealt,
  dealtItem,
  hovered,
  peek,
  press,
  quietPress,
  revealed,
  tuck,
  yielded
} from './motion'
import { CloseIcon } from './screenIcons'
import { LoadCharacterModal } from './LoadCharacterModal'

/**
 * Up to `count` of the eligible characters at random, no two sharing a first name with each
 * other or with anybody in `taken`.
 */
function drawUnique(
  eligible: readonly string[],
  characters: Readonly<Record<string, Character>>,
  taken: readonly Character[],
  count: number
): Character[] {
  const names = new Set(taken.map(firstNameKeyOf))
  const picked: Character[] = []
  for (const charId of shuffle(eligible)) {
    if (picked.length >= count) break
    const character = characters[charId]
    const key = firstNameKeyOf(character)
    if (names.has(key)) continue
    names.add(key)
    picked.push(character)
  }
  return picked
}

/** The grid dealing its tiles in, built once so its variant tree keeps its identity. */
const GRID_IN = dealt(0.25, 0.04)

/** A roster being picked: who could still join it, who clashes, and the two modals it opens. */
export interface Roster {
  roster: Character[]
  /** How many characters it holds once filled: every tile the grid draws. */
  size: number
  /** Characters that could still be added: fully rendered, not already picked, not graduated. */
  eligible: string[]
  isDuplicate: (character: Character) => boolean
  /** Each first name the roster and the graduates share, as the names that share it. */
  duplicates: () => string[]
  /** Fills the empty slots with random eligible characters, keeping the ones already picked. */
  fillRandom: () => void
  /**
   * A random eligible character for every empty slot, by charId, put on nobody's roster yet; null
   * where there are not enough with first names of their own.
   */
  drawEmpty: () => string[] | null
  /** Whether the picker or a character's sheet is over the screen. */
  covered: boolean
  locked: ReadonlySet<string>
  alumni: readonly string[]
  setRoster: (next: Character[]) => void
  picking: boolean
  setPicking: (picking: boolean) => void
  inspecting: string | null
  setInspecting: (charId: string | null) => void
}

/**
 * The roster a New Game or a next semester's New Game+ is picking, `size` of them once filled.
 * `alumni` are never pickable and their first names are taken; `locked` girls stay on it.
 */
export function useRoster(
  roster: Character[],
  size: number,
  setRoster: (next: Character[]) => void,
  alumni: readonly string[],
  locked: ReadonlySet<string>
): Roster {
  const characters = useCharacterStore((s) => s.characters)
  const allOrder = useCharacterStore((s) => s.order)
  const removedDefaults = useCharacterStore((s) => s.removedDefaults)
  const expressions = useCharacterStore((s) => s.expressions)
  // `order` minus the shipped characters he has removed.
  const order = useMemo(
    () => visibleOrderOf({ order: allOrder, removedDefaults }),
    [allOrder, removedDefaults]
  )
  const [picking, setPicking] = useState(false)
  const [inspecting, setInspecting] = useState<string | null>(null)

  const graduates = useMemo(
    () => alumni.flatMap((charId) => (characters[charId] ? [characters[charId]] : [])),
    [alumni, characters]
  )

  const eligible = useMemo(
    () =>
      order.filter(
        (charId) =>
          EMOTIONS.every((emotion) => expressions[charId]?.[emotion]) &&
          !roster.some((c) => c.charId === charId) &&
          !alumni.includes(charId)
      ),
    [order, expressions, roster, alumni]
  )

  /**
   * Warms the picker's sprites while the reader is still on the roster: `LoadCharacterModal`
   * mounts one per finished character at once, and decoding them all on the frame it opens is
   * a visible stall.
   */
  const pickerUrls = useMemo(() => eligible.map((charId) => spriteUrl(charId, 'neutral')), [eligible])
  useWarmedImages(pickerUrls, true)

  /** First names appearing more than once among the roster and the graduates. */
  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>()
    for (const character of [...roster, ...graduates]) {
      const key = firstNameKeyOf(character)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([key]) => key))
  }, [roster, graduates])

  const empty = size - roster.length

  function fillRandom(): void {
    const picked = drawUnique(eligible, characters, [...roster, ...graduates], empty)
    if (picked.length > 0) setRoster([...roster, ...picked])
  }

  function drawEmpty(): string[] | null {
    const picked = drawUnique(eligible, characters, [...roster, ...graduates], empty)
    return picked.length < empty ? null : picked.map((c) => c.charId)
  }

  return {
    roster,
    size,
    eligible,
    isDuplicate: (character) => duplicateKeys.has(firstNameKeyOf(character)),
    duplicates: () =>
      [...duplicateKeys].map((key) =>
        [...roster, ...graduates]
          .filter((c) => firstNameKeyOf(c) === key)
          .map(fullNameOf)
          .join(' and ')
      ),
    fillRandom,
    drawEmpty,
    covered: picking || inspecting !== null,
    locked,
    alumni,
    setRoster,
    picking,
    setPicking,
    inspecting,
    setInspecting
  }
}

/**
 * Every tile the roster holds, filled ones first, so the count reads at a glance. An empty tile
 * holds a `?`, since Next fills it at random. A roster grown by a step scrolls its new last tile
 * into view.
 */
export function RosterGrid({ roster: state }: { roster: Roster }): JSX.Element {
  const { roster, size, locked, isDuplicate, setInspecting, setRoster, setPicking } = state
  const grid = useRef<HTMLUListElement>(null)
  const still = useReducedMotion()
  // The size the grid last drew, so only a step up scrolls and the grid arriving does not.
  const drawn = useRef(size)

  useEffect(() => {
    const grew = size > drawn.current
    drawn.current = size
    const node = grid.current
    if (!grew || !node) return
    // The new tile is the last, so the end of the scroll is where it stands clear of the fade at
    // the grid's foot.
    node.scrollTo({ top: node.scrollHeight, behavior: still ? 'auto' : 'smooth' })
  }, [size, still])

  return (
    <div className="vu-scroll-box vu-newgame-grid-box">
      <motion.ul
        ref={grid}
        className="vu-newgame-grid"
        variants={GRID_IN}
        initial="hidden"
        animate="shown"
      >
        {Array.from({ length: size }, (_, index) => {
          const character = roster[index]
          return character ? (
            <RosterTile
              key={character.charId}
              character={character}
              duplicate={isDuplicate(character)}
              locked={locked.has(character.charId)}
              onOpen={() => setInspecting(character.charId)}
              onRemove={() => setRoster(roster.filter((c) => c.charId !== character.charId))}
            />
          ) : (
            <EmptyTile key={`slot-${index}`} onPick={() => setPicking(true)} />
          )
        })}
      </motion.ul>
    </div>
  )
}

/** The picker and a picked character's sheet; each a presence of its own. */
export function RosterModals({
  roster: state,
  theme
}: {
  roster: Roster
  theme: 'day' | 'night'
}): JSX.Element {
  const { roster, alumni, picking, setPicking, inspecting, setInspecting, isDuplicate, setRoster } =
    state
  const inspected = roster.find((c) => c.charId === inspecting) ?? null
  return (
    <>
      <AnimatePresence>
        {picking && (
          <LoadCharacterModal
            key="picker"
            taken={[...roster.map((c) => c.charId), ...alumni]}
            theme={theme}
            onClose={() => setPicking(false)}
            onPick={(character) => {
              setPicking(false)
              setRoster([...roster, character])
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {inspected && (
          <CharacterModal
            key={inspected.charId}
            character={inspected}
            theme={theme}
            duplicate={isDuplicate(inspected)}
            onClose={() => setInspecting(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}

/**
 * One character on the roster: her archway, her name, and the ✕ that takes her off it — or, for
 * a girl returning to a next semester, the sticker saying she stays.
 */
function RosterTile({
  character,
  duplicate,
  locked,
  onOpen,
  onRemove
}: {
  character: Character
  duplicate: boolean
  locked: boolean
  onOpen: () => void
  onRemove: () => void
}): JSX.Element {
  // Held on the tile rather than in the view, so a character removed under the cursor takes
  // her hover with her — motion reports no hover ending for an element that unmounts.
  const [pointerOver, setPointerOver] = useState(false)
  const name = fullNameOf(character)

  return (
    <motion.li
      className={`vu-card vu-newgame-card${duplicate ? ' vu-newgame-card--duplicate' : ''}`}
      variants={dealtItem}
      onHoverStart={() => setPointerOver(true)}
      onHoverEnd={() => setPointerOver(false)}
      {...hovered(false, cardLift)}
    >
      <motion.button className="vu-card-face" whileTap={press} onClick={onOpen}>
        <div className="vu-arch vu-newgame-arch vu-paper">
          <div className="vu-crop vu-card-crop">
            <img
              className="vu-card-sprite"
              src={spriteUrl(character.charId, 'neutral')}
              alt=""
            />
          </div>
        </div>
        <CardCaption character={character} />
      </motion.button>

      {/* A sibling of the face, never inside it: a button in a button is not a thing, and
          the arrangement is what keeps a removal from also opening her. */}
      {locked ? (
        <span className="vu-sticker vu-newgame-sticker">Returning</span>
      ) : (
        <motion.button
          className="vu-x vu-card-x"
          aria-label={`Remove ${name} from the roster`}
          initial={false}
          animate={pointerOver ? peek : tuck}
          whileFocus={peek}
          whileTap={quietPress}
          onClick={onRemove}
        >
          <CloseIcon />
        </motion.button>
      )}
    </motion.li>
  )
}

/**
 * A slot with nobody in it: the same tile, quiet and dashed, that opens the picker. It holds a
 * `?`, giving way to the plus while it is under the pointer or focused.
 */
function EmptyTile({ onPick }: { onPick: () => void }): JSX.Element {
  // Held on the tile, so a tile filled under the cursor takes its hover with it.
  const [pointerOver, setPointerOver] = useState(false)
  const [focused, setFocused] = useState(false)
  return (
    <motion.li
      className="vu-card vu-newgame-card vu-newgame-card--empty"
      variants={dealtItem}
      onHoverStart={() => setPointerOver(true)}
      onHoverEnd={() => setPointerOver(false)}
      {...hovered(false, cardLift)}
    >
      <motion.button
        className="vu-card-face"
        aria-label="Add a character"
        whileTap={press}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={onPick}
      >
        {/* No paper layer: a slot that is waiting has no weight. */}
        <div className="vu-arch vu-newgame-arch">
          <div className="vu-crop vu-card-crop vu-card-crop--empty">
            <motion.span
              className="vu-newgame-seat"
              initial={false}
              animate={pointerOver || focused ? 'shown' : 'hidden'}
            >
              <motion.span className="vu-newgame-plus" variants={yielded}>
                ?
              </motion.span>
              <motion.span className="vu-newgame-plus" variants={revealed}>
                +
              </motion.span>
            </motion.span>
          </div>
        </div>
        <div className="vu-card-caption">
          <span className="vu-card-name">Empty</span>
        </div>
      </motion.button>
    </motion.li>
  )
}
