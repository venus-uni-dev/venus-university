import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { useUiStore } from '../stores/uiStore'
import dayUrl from '../../../assets/anon_msg_example_day.png'
import nightUrl from '../../../assets/anon_msg_example_night.png'
import {
  gestures,
  lift,
  linkLift,
  panelUnderTab,
  press,
  quietLift,
  quietPress,
  veilIn
} from './motion'
import '../vu_styles/Support.css'

/** Where a donation goes; the link and the Donate answer both open it. */
const KOFI_URL = 'https://ko-fi.com/venusdev'

export interface SupportModalProps {
  /** Drawn by whatever opened this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
}

/**
 * The Support Development modal, opened from the Main Menu: what supporting the game actually
 * means, and the Ko-fi a donation goes through.
 */
export function SupportModal({ theme }: SupportModalProps): JSX.Element | null {
  const closeModal = useUiStore((s) => s.closeModal)
  const close = (): void => closeModal('support')

  const { host, overlayProps } = useModalShell(close)
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
        id="support-modal"
        className="vu-note vu-support vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Support Development"
        variants={panelUnderTab}
      >
        <TitleTab>Support Development</TitleTab>

        <p className="vu-note-text">
          Venus University is and always will be free since I want as many people as possible to
          enjoy the game. The best way to support development is to share the game with others and
          send me feedback.
        </p>
        <p className="vu-note-text">
          If you&apos;d like to make a donation, you can do so on my Ko-fi:{' '}
          {/* `target="_blank"` is what routes it through main's window-open handler, which hands
              the address to the browser, as the Credits links leave the app. */}
          <motion.a
            id="support-kofi"
            className="vu-link vu-support-kofi"
            href={KOFI_URL}
            target="_blank"
            rel="noreferrer"
            whileHover={linkLift}
            whileFocus={linkLift}
          >
            https://ko-fi.com/venusdev
          </motion.a>
          . 
        </p>
        <p className="vu-note-text">
          If you include a username or name with your donation, I will put you in the credits of
          the game and include you as a possible username for anonymous Bunnyboard posts. Thank you
          for playing!
        </p>
        <img
          className="vu-support-example"
          src={theme === 'night' ? nightUrl : dayUrl}
          alt="An example Bunnyboard post"
          decoding="async"
        />

        <div className="vu-foot vu-note-foot">
          <motion.button
            id="support-close"
            className="vu-btn vu-btn--quiet"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={close}
          >
            Close
          </motion.button>
          {/* The same door as the link: `window.open` reaches main's window-open handler. */}
          <motion.button
            id="support-donate"
            className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
            type="button"
            {...gestures(false, lift, press)}
            onClick={() => window.open(KOFI_URL)}
          >
            Donate on Ko-fi
            <OutIcon />
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}

/**
 * The mark that says the answer leaves the app: a box open at its top-right corner and an arrow
 * going out through the gap. It stays in this file because only this screen wears it.
 */
function OutIcon(): JSX.Element {
  return (
    <svg
      className="vu-support-out"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 13.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V8a1.5 1.5 0 0 1 1.5-1.5H11" />
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
    </svg>
  )
}
