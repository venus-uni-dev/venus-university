import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { isCustomOutfitSlot, outfitLabelOf } from '@shared/outfits'
import type { Character, CustomOutfitSlot, OutfitLock } from '@shared/types'
import { placeUnder } from '../components/popupPlace'
import { useEscapeLayer, useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { PORTRAIT_SLOTS, UNKNOWN_NAME, useGameStore } from '../stores/gameStore'
import { noNsfwImagesOf, useSettingsStore } from '../stores/settingsStore'
import { displaySlotsOf } from '../stores/stageDisplay'
import { profileUrl, useCharacterStore } from '../stores/characterStore'
import type { ScreenTheme } from './clockTheme'
import { ChevronIcon } from './screenIcons'
import { gestures, lift, panelUnderTab, press, quietPress, toggleLift, veilIn } from './motion'
import '../vu_styles/Cast.css'
import '../vu_styles/PopList.css'

export interface CastModalProps {
  /** Drawn by the screen that opened this — a portal inherits neither palette nor state rules. */
  theme: ScreenTheme
  onClose: () => void
}

/** The air between the pill and the wardrobe list hung under it. */
const POP_GAP = 6

/** Who is in the scene and who is on screen, with the stage in the player's own hands. */
export function CastModal({ theme, onClose }: CastModalProps): JSX.Element | null {
  const cast = useGameStore((s) => s.cast)
  const slots = useGameStore((s) => s.slots)
  const departed = useGameStore((s) => s.departed)
  const characters = useGameStore((s) => s.characters)
  const charInfo = useGameStore((s) => s.charInfo)
  const stageOverride = useGameStore((s) => s.stageOverride)
  const outfitLock = useGameStore((s) => s.outfitLock)
  const outfitReady = useGameStore((s) => s.outfitReady)
  const toggleStageChar = useGameStore((s) => s.toggleStageChar)
  const setOutfitLock = useGameStore((s) => s.setOutfitLock)
  const noNsfwImages = useSettingsStore(noNsfwImagesOf)
  // Reframing a portrait re-cuts the file behind its URL, so a row reads the version.
  const versions = useCharacterStore((s) => s.spriteVersion)
  // The frame the floating wardrobe lists are placed against, and the one row whose list is up.
  const [popupHost, setPopupHost] = useState<HTMLElement | null>(null)
  const [openFor, setOpenFor] = useState<string | null>(null)

  const { host, overlayProps } = useModalShell(onClose)
  useEscapeLayer(() => setOpenFor(null), openFor !== null)
  if (!host) return null

  const shownSlots = displaySlotsOf(slots, stageOverride)
  const full = shownSlots.filter(Boolean).length >= PORTRAIT_SLOTS
  const here = cast.filter((charId) => !departed.includes(charId) && characters[charId])

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
        id="cast"
        className="vu-sheet vu-cast vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Who is on screen"
        variants={panelUnderTab}
      >
        <TitleTab>Who is on screen</TitleTab>

        <div className="vu-scroll-box">
          <div className="vu-cast-body">
            {here.length === 0 ? (
              <p className="vu-empty">Nobody is in this scene.</p>
            ) : (
              here.map((charId) => {
                const character = characters[charId]
                // Masked as the name box masks a speaker.
                const name = charInfo[charId]?.nameKnown ? character.firstName : UNKNOWN_NAME
                const shown = shownSlots.includes(charId)
                // A full stage has no slot to put her in.
                const dead = !shown && full
                // Withheld, the nude pill is absent rather than dead. A lock left
                // standing on it degrades through `displaySpriteRef`.
                const ready = outfitReady[charId] ?? []
                const sets = ready.filter(
                  (set) => !isCustomOutfitSlot(set) && !(noNsfwImages && set === 'nude')
                )
                // Her player-authored wardrobes stand behind one pill of their own, and her
                // main outfit is offered as long as there is any lock at all to come off.
                const customs = ready.filter(isCustomOutfitSlot)
                const locks: OutfitLock[] =
                  sets.length > 0 || customs.length > 0 ? ['default', ...sets] : []

                return (
                  <div className="vu-row vu-cast-row" key={charId}>
                    <div className="vu-cast-head">
                      <span className="vu-arch vu-cast-face">
                        <span className="vu-crop">
                          <img
                            className="vu-crop-img"
                            src={profileUrl(charId, versions[charId] ?? 0)}
                            alt=""
                          />
                        </span>
                      </span>
                      <span className="vu-cast-who">
                        <span className="vu-cast-name">{name}</span>
                        <span className="vu-cast-state">{shown ? 'ON SCREEN' : 'OFF SCREEN'}</span>
                      </span>
                      <motion.button
                        id={`cast-toggle-${charId}`}
                        className="vu-btn vu-btn--outline vu-btn--panel vu-paper"
                        type="button"
                        disabled={dead}
                        {...gestures(dead, lift, press)}
                        onClick={() => toggleStageChar(charId)}
                      >
                        {shown ? 'Hide' : 'Show'}
                      </motion.button>
                    </div>

                    {/* Absent for a character with no wardrobe rendered on disk. */}
                    {locks.length > 0 && (
                      <div className="vu-cast-outfits">
                        {locks.map((lock) => {
                          const active = outfitLock[charId] === lock
                          return (
                            <motion.button
                              key={lock}
                              className={`vu-pill${active ? ' vu-pill--on' : ''}`}
                              type="button"
                              aria-pressed={active}
                              {...gestures(false, toggleLift, quietPress)}
                              onClick={() => setOutfitLock(charId, active ? null : lock)}
                            >
                              {lock === 'default' ? 'Default' : outfitLabelOf(character, lock)}
                            </motion.button>
                          )
                        })}
                        {customs.length > 0 && (
                          <CustomOutfitPill
                            charId={charId}
                            character={character}
                            slots={customs}
                            lock={outfitLock[charId]}
                            setLock={(lock) => setOutfitLock(charId, lock)}
                            open={openFor === charId}
                            setOpenFor={setOpenFor}
                            popupHost={popupHost}
                          />
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
          <div className="vu-scroll-fade" />
        </div>

        {/* A panel with nothing to spend has one answer: nothing here costs anything. */}
        <div className="vu-foot">
          <motion.button
            id="cast-close"
            className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
            type="button"
            {...gestures(false, lift, press)}
            onClick={onClose}
          >
            Close
          </motion.button>
        </div>

        {/* The frame a wardrobe list is placed against, over the rows and taking no pointer
            of its own. */}
        <div className="vu-popups" ref={setPopupHost} />
      </motion.div>
    </motion.div>,
    host
  )
}

interface CustomOutfitPillProps {
  charId: string
  character: Character
  /** The player-authored wardrobes she has fully rendered, in slot order. */
  slots: readonly CustomOutfitSlot[]
  lock: OutfitLock | undefined
  setLock: (lock: OutfitLock | null) => void
  /** Whether this row's list is the one standing open. */
  open: boolean
  /** The modal's one open list, by charId, so opening one takes any other down. */
  setOpenFor: (openFor: string | null) => void
  /** The layer inside the panel the list is portalled into; `null` until it resolves. */
  popupHost: HTMLElement | null
}

/**
 * One character's player-authored wardrobes, behind a pill that opens a floating list of them.
 * Under a lock the pill names the wardrobe in force and is the way back off it.
 */
function CustomOutfitPill({
  charId,
  character,
  slots,
  lock,
  setLock,
  open,
  setOpenFor,
  popupHost
}: CustomOutfitPillProps): JSX.Element {
  const pill = useRef<HTMLButtonElement | null>(null)
  const pop = useRef<HTMLDivElement | null>(null)
  // The row under the pointer, tinted by that state as a suggestion list's is.
  const [hovered, setHovered] = useState(-1)

  // A lock on a slot that is no longer rendered is nobody's: the stage draws around it.
  const picked = slots.find((slot) => slot === lock) ?? null
  const showList = open && picked === null && popupHost !== null

  /** Hangs the list under the pill, never narrower than the pill it hangs off. */
  const reposition = useCallback((): void => {
    const box = pill.current
    const layer = pop.current
    const panel = popupHost?.parentElement
    if (!box || !layer || !panel) return
    layer.style.setProperty('min-width', `${Math.round(box.offsetWidth)}px`)
    placeUnder(box, layer, panel, POP_GAP, false)
  }, [popupHost])

  useLayoutEffect(reposition, [reposition, showList, slots.length])

  // The list follows the column it hangs in and the window it is drawn on for as long as it is up.
  useEffect(() => {
    const panel = popupHost?.parentElement
    if (!showList || !panel) return
    panel.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      panel.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [showList, popupHost, reposition])

  // A press on neither the pill nor the list itself takes the list down.
  useEffect(() => {
    if (!showList) return
    const handleMouseDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (pill.current?.contains(target) === true || pop.current?.contains(target) === true) return
      setOpenFor(null)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [showList, setOpenFor])

  /** Locked, the pill lets her wardrobe go; free, it raises the list of the ones she has. */
  function handleClick(): void {
    if (picked !== null) {
      setLock(null)
      return
    }
    setHovered(-1)
    setOpenFor(open ? null : charId)
  }

  return (
    <>
      <motion.button
        ref={pill}
        id={`cast-custom-${charId}`}
        className={`vu-pill${picked !== null ? ' vu-pill--on' : ''}`}
        type="button"
        aria-pressed={picked !== null ? true : undefined}
        aria-haspopup={picked === null ? 'listbox' : undefined}
        aria-expanded={picked === null ? showList : undefined}
        {...gestures(false, toggleLift, quietPress)}
        onClick={handleClick}
      >
        {picked !== null ? outfitLabelOf(character, picked) : 'Custom outfit'}
        {picked === null && <ChevronIcon down />}
      </motion.button>
      {showList &&
        popupHost !== null &&
        createPortal(
          <div ref={pop} className="vu-pop">
            <div className="vu-pop-list" role="listbox" aria-label="Custom outfits">
              {slots.map((slot, index) => (
                <button
                  key={slot}
                  type="button"
                  className={`vu-pop-option${index === hovered ? ' vu-pop-option--on' : ''}`}
                  role="option"
                  aria-selected={lock === slot}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(-1)}
                  onClick={() => {
                    setOpenFor(null)
                    setLock(slot)
                  }}
                >
                  {outfitLabelOf(character, slot)}
                </button>
              ))}
            </div>
            <div className="vu-scroll-fade" />
          </div>,
          popupHost
        )}
    </>
  )
}
