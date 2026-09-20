import { useCallback, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { READER_SPEAKER } from '@shared/types'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { graduationScrollLines, isEpilogueNight } from '../prompts/graduation'
import { speakerNameOf } from '../stores/gameLoop'
import { seniorNames } from '../stores/loop/farewells'
import { useGameStore } from '../stores/gameStore'
import { sceneActiveOf, sceneOnScreenOf } from '../stores/textingLoop'
import type { ScreenTheme } from './clockTheme'
import { gestures, lift, panelUnderTab, press, veilIn } from './motion'
import '../vu_styles/ChatLog.css'

export interface ChatLogModalProps {
  /** Drawn by the screen that opened this — a portal inherits neither palette nor state rules. */
  theme: ScreenTheme
  onClose: () => void
}

/**
 * The scene so far, as the player read it. Renders `sceneLog` and nothing else — never
 * `sceneSummary`, which is written for the model. On the goodbye menu it holds the last goodbye
 * instead, since the epilogue's save carries no scene of its own to render.
 */
export function ChatLogModal({ theme, onClose }: ChatLogModalProps): JSX.Element | null {
  const sceneLog = useGameStore((s) => s.sceneLog)
  const farewellLog = useGameStore((s) => s.farewellLog)
  const date = useGameStore((s) => s.date)
  const time = useGameStore((s) => s.time)
  const graduationSeen = useGameStore((s) => s.graduationSeen)
  const sceneActive = useGameStore(sceneActiveOf)
  const inScene = useGameStore(sceneOnScreenOf)
  const { host, overlayProps } = useModalShell(onClose)

  /** The goodbye menu itself, rather than one of the goodbyes it opens. */
  const menu = isEpilogueNight(date, time, graduationSeen) && !sceneActive

  /**
   * A scene on screen shows only the reader's own doing — the slot's opening narration precedes
   * his first action and belongs to the landing, not to what he has said or done since. The
   * landing itself still shows the whole log, there being no scene yet to cut it down to.
   */
  const start = inScene
    ? Math.max(
        0,
        sceneLog.findIndex((line) => line.speaker === READER_SPEAKER)
      )
    : 0
  const visible = menu
    ? farewellLog.length > 0
      ? farewellLog
      : graduationScrollLines(seniorNames())
    : sceneLog.slice(start)

  /**
   * Opens on the newest line, with older ones above it. A callback ref rather than an
   * effect: the host resolves after mount, so nothing is in the DOM to scroll until the render
   * that actually portals, which is exactly the render this fires on.
   */
  const scrollToLatest = useCallback((box: HTMLDivElement | null) => {
    if (box) box.scrollTop = box.scrollHeight
  }, [])

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
        id="chat-log"
        className="vu-sheet vu-chatlog vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Chat log"
        variants={panelUnderTab}
      >
        <TitleTab>Chat log</TitleTab>

        <div className="vu-scroll-box">
          {/* The second well in the app that opts back into selection, after the error's. */}
          <div className="vu-chatlog-body" ref={scrollToLatest} data-cursor="text">
            {visible.length === 0 ? (
              <p className="vu-empty vu-chatlog-empty">Nothing has happened yet.</p>
            ) : (
              visible.map((line, index) => {
                const speaker = speakerNameOf(line)
                // The player's own submissions are set apart.
                const reader = line.speaker === READER_SPEAKER
                return (
                  // Lines carry no id and the list is append-only, so the index is the key.
                  <div
                    className={`vu-row vu-chatlog-line${reader ? ' vu-chatlog-line--reader' : ''}`}
                    key={index}
                  >
                    {speaker && <span className="vu-chatlog-speaker">{speaker}</span>}
                    <span className="vu-chatlog-text">{line.text}</span>
                  </div>
                )
              })
            )}
          </div>
          <div className="vu-scroll-fade" />
        </div>

        {/* A panel with nothing to spend has one answer. */}
        <div className="vu-foot">
          <motion.button
            id="chat-log-close"
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
