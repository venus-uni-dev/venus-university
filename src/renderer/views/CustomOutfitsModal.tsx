import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { WardrobeColumn, type WardrobeColumnProps } from '../components/WardrobeColumn'
import type { CustomOutfitSlot } from '@shared/types'
import { gestures, lift, panelUnderTab, press, veilIn } from './motion'
import '../vu_styles/EditCharacter.css'
import '../vu_styles/CustomOutfits.css'

export interface CustomOutfitsModalProps {
  /** Drawn by the screen that opened this — a portal inherits neither. */
  theme: 'day' | 'night'
  /** The five slots in slot order, each with the column the editor built for it. */
  slots: ReadonlyArray<{ slot: CustomOutfitSlot; column: WardrobeColumnProps }>
  onClose: () => void
}

/**
 * The five player-authored wardrobes side by side, at the size the game will show a sprite.
 * Every control on them is the Edit modal's, which keeps its own confirms and tag modals.
 */
export function CustomOutfitsModal({
  theme,
  slots,
  onClose
}: CustomOutfitsModalProps): JSX.Element | null {
  const { host, overlayProps } = useModalShell(onClose)
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
        id="custom-outfits"
        className="vu-sheet--wide vu-customs vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Custom outfits"
        variants={panelUnderTab}
      >
        <TitleTab>Custom outfits</TitleTab>

        <div className="vu-customs-grid">
          {slots.map(({ slot, column }) => (
            <WardrobeColumn key={slot} {...column} />
          ))}
        </div>

        <div className="vu-foot">
          <motion.button
            id="custom-outfits-close"
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
