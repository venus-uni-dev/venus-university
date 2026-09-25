import { Fragment, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { isWebBuild } from '../platform'
import { gestures, lift, panelUnderTab, press, veilIn } from './motion'
import '../vu_styles/Controls.css'

/** One hotkey: the keys that do it, any of them alone, and what it does. */
interface ControlRow {
  keys: string[]
  does: string
}

interface ControlSection {
  title: string
  rows: ControlRow[]
}

const SCENE: ControlSection = {
  title: 'In a scene',
  rows: [
    { keys: ['Enter', 'Space'], does: 'Advance text' },
    {
      keys: ['Tab'],
      does: 'Auto-focus text box'
    },
    { keys: ['Mouse wheel', '←/→'], does: 'Rewind or go forward' },
    { keys: ['H'], does: 'Hide UI' },
    { keys: ['Esc', 'Right-click'], does: 'Open/close pause menu' }
  ]
}

const EVERYWHERE: ControlSection = {
  title: 'Everywhere',
  rows: [
    { keys: ['Escape', 'Right-click'], does: 'Close a panel' },
    { keys: ['Enter'], does: "Submit form" },
  ]
}

/** The desktop app's own window key, which a browser tab keeps for itself. */
const FULLSCREEN: ControlRow = { keys: ['F11'], does: 'Fullscreen toggle' }

/** The two sections, the fullscreen row dropped where the app has no window of its own. */
function sectionsOf(web: boolean): ControlSection[] {
  if (web) return [SCENE, EVERYWHERE]
  return [SCENE, { ...EVERYWHERE, rows: [...EVERYWHERE.rows, FULLSCREEN] }]
}

export interface ControlsModalProps {
  /** Drawn by the screen that opened this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
  onClose: () => void
}

/** The Game menu's list of the keys the app answers, and what each one does. */
export function ControlsModal({ theme, onClose }: ControlsModalProps): JSX.Element | null {
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
        id="controls-modal"
        className="vu-sheet vu-controls vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Controls"
        variants={panelUnderTab}
      >
        <TitleTab>Controls</TitleTab>

        <div className="vu-scroll-box">
          <div className="vu-controls-body">
            {sectionsOf(isWebBuild()).map((section) => (
              <section key={section.title} className="vu-controls-section">
                <h3 className="vu-controls-title">{section.title}</h3>
                <ul className="vu-controls-list">
                  {section.rows.map((row) => (
                    <li key={row.keys.join(' ')} className="vu-row vu-controls-row">
                      <span className="vu-controls-keys">
                        {row.keys.map((key, i) => (
                          <Fragment key={key}>
                            {i > 0 && <span className="vu-controls-or">or</span>}
                            <kbd className="vu-controls-key">{key}</kbd>
                          </Fragment>
                        ))}
                      </span>
                      <span className="vu-controls-does">{row.does}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <div className="vu-scroll-fade" />
        </div>

        {/* A panel with nothing to spend has one answer. */}
        <div className="vu-foot">
          <motion.button
            id="controls-close"
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
