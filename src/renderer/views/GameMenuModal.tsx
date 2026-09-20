import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import {
  dealt,
  dealtItem,
  gestures,
  lift,
  panelUnderTab,
  press,
  quietLift,
  quietPress,
  veilIn
} from './motion'
import '../vu_styles/GameMenu.css'

export interface GameMenuModalProps {
  /** Drawn by the screen that opened this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
  onClose: () => void
  onLoadGame: () => void
  onFeedback: () => void
  onSettings: () => void
  onLeave: () => void
  /** Absent where the app has no window of its own to close, which drops the entry. */
  onQuit?: () => void
}

/**
 * The Game menu: the ⚙ on the rail and Escape both open it. A fan of outline answers rather
 * than a question with one answer on the right, so they read as a list; the foot only backs out.
 */
export function GameMenuModal({
  theme,
  onClose,
  onLoadGame,
  onFeedback,
  onSettings,
  onLeave,
  onQuit
}: GameMenuModalProps): JSX.Element | null {
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
        id="game-menu"
        className="vu-menu-modal vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        variants={panelUnderTab}
      >
        <TitleTab>Menu</TitleTab>

        <motion.nav className="vu-menu-modal-actions vu-fan" variants={dealt(0, 0.045)}>
          <motion.button
            id="game-menu-settings"
            className="vu-btn vu-btn--outline vu-paper"
            type="button"
            variants={dealtItem}
            {...gestures(false, lift, press)}
            onClick={onSettings}
          >
            Settings
          </motion.button>
          <motion.button
            id="game-menu-load"
            className="vu-btn vu-btn--outline vu-paper"
            type="button"
            variants={dealtItem}
            {...gestures(false, lift, press)}
            onClick={onLoadGame}
          >
            Load Game
          </motion.button>
          <motion.button
            id="game-menu-feedback"
            className="vu-btn vu-btn--outline vu-paper"
            type="button"
            variants={dealtItem}
            {...gestures(false, lift, press)}
            onClick={onFeedback}
          >
            Report a bug
          </motion.button>
          <motion.button
            id="game-menu-leave"
            className="vu-btn vu-btn--outline vu-paper"
            type="button"
            variants={dealtItem}
            {...gestures(false, lift, press)}
            onClick={onLeave}
          >
            Return to main menu
          </motion.button>
          {onQuit && (
            <motion.button
              id="game-menu-quit"
              className="vu-btn vu-btn--outline vu-paper"
              type="button"
              variants={dealtItem}
              {...gestures(false, lift, press)}
              onClick={onQuit}
            >
              Quit game
            </motion.button>
          )}
        </motion.nav>

        {/* No primary: the entries above are the answers, and this only backs out
            (the modal-close rule — a modal is left by a button, never a ✕). */}
        <div className="vu-foot">
          <motion.button
            id="game-menu-back"
            className="vu-btn vu-btn--quiet"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={onClose}
          >
            Back to game
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
