import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { OUTFIT_SET_LABELS } from '@shared/outfits'
import type { OutfitLock } from '@shared/types'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { PORTRAIT_SLOTS, UNKNOWN_NAME, useGameStore } from '../stores/gameStore'
import { noNsfwImagesOf, useSettingsStore } from '../stores/settingsStore'
import { displaySlotsOf } from '../stores/stageDisplay'
import { profileUrl, useCharacterStore } from '../stores/characterStore'
import type { ScreenTheme } from './clockTheme'
import { gestures, lift, panelUnderTab, press, quietPress, toggleLift, veilIn } from './motion'
import '../vu_styles/Cast.css'

export interface CastModalProps {
  /** Drawn by the screen that opened this — a portal inherits neither palette nor state rules. */
  theme: ScreenTheme
  onClose: () => void
}

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

  const { host, overlayProps } = useModalShell(onClose)
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
                const sets = (outfitReady[charId] ?? []).filter(
                  (set) => !(noNsfwImages && set === 'nude')
                )
                const locks: OutfitLock[] = sets.length > 0 ? ['default', ...sets] : []

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
                              {lock === 'default' ? 'Default' : OUTFIT_SET_LABELS[lock]}
                            </motion.button>
                          )
                        })}
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
      </motion.div>
    </motion.div>,
    host
  )
}
