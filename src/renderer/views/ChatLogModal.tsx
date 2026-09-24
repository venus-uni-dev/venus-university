import { useCallback, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { READER_SPEAKER } from '@shared/types'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { useFitToText } from '../components/useFitToText'
import { graduationScrollLines, isEpilogueNight } from '../prompts/graduation'
import { rewriteLine, speakerNameOf } from '../stores/gameLoop'
import { seniorNames } from '../stores/loop/farewells'
import { useGameStore } from '../stores/gameStore'
import { lineEditable } from '../stores/stageStep'
import { sceneActiveOf, sceneOnScreenOf } from '../stores/textingLoop'
import type { ScreenTheme } from './clockTheme'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import { CheckIcon, CloseIcon, PencilIcon } from './screenIcons'
import '../vu_styles/ChatLog.css'

export interface ChatLogModalProps {
  /** Drawn by the screen that opened this — a portal inherits neither palette nor state rules. */
  theme: ScreenTheme
  onClose: () => void
}

/**
 * The scene so far, as the player read it. Renders `sceneLog` and nothing else — never
 * `sceneSummary`, which is written for the model — and rewrites any reply line of it in place,
 * one row at a time, never the reader's own line or a status line, and none while the scene's
 * ending is under way. On the goodbye menu it holds the last goodbye instead, since the
 * epilogue's save carries no scene of its own to render, and nothing there can be rewritten.
 */
export function ChatLogModal({ theme, onClose }: ChatLogModalProps): JSX.Element | null {
  const sceneLog = useGameStore((s) => s.sceneLog)
  const farewellLog = useGameStore((s) => s.farewellLog)
  const date = useGameStore((s) => s.date)
  const time = useGameStore((s) => s.time)
  const graduationSeen = useGameStore((s) => s.graduationSeen)
  const sceneEnding = useGameStore((s) => s.sceneEnding)
  const sceneActive = useGameStore(sceneActiveOf)
  const inScene = useGameStore(sceneOnScreenOf)
  const { host, overlayProps } = useModalShell(onClose)

  /**
   * The one line being rewritten, by its place in `sceneLog`, and the words in its box so far.
   * It lives only as long as the modal: closing mid-edit drops the rewrite without asking.
   */
  const [edit, setEdit] = useState<{ at: number; text: string } | null>(null)

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
                // The line's own place in `sceneLog`, which is what a rewrite is keyed on.
                const at = start + index
                const editable = !menu && !sceneEnding && lineEditable(sceneLog, at)
                const editing = editable && edit?.at === at
                return (
                  // Lines carry no id and the list is append-only, so the index is the key.
                  <div
                    className={`vu-row vu-chatlog-line${reader ? ' vu-chatlog-line--reader' : ''}`}
                    key={index}
                  >
                    <div className="vu-chatlog-line-body">
                      {speaker && <span className="vu-chatlog-speaker">{speaker}</span>}
                      {editing ? (
                        <LineEditBox
                          text={edit.text}
                          onChange={(text) => setEdit({ at, text })}
                        />
                      ) : (
                        <span className="vu-chatlog-text">{line.text}</span>
                      )}
                    </div>
                    {/* Every row keeps the column, empty where the line cannot be rewritten, so
                        the words line up down the log. */}
                    <div className="vu-chatlog-tools">
                      {editing ? (
                        <>
                          <motion.button
                            className="vu-chatlog-tool"
                            type="button"
                            aria-label="Save line"
                            disabled={!edit.text.trim()}
                            {...gestures(!edit.text.trim(), quietLift, quietPress)}
                            onClick={() => {
                              rewriteLine(edit.at, edit.text)
                              setEdit(null)
                            }}
                          >
                            <CheckIcon />
                          </motion.button>
                          <motion.button
                            className="vu-chatlog-tool"
                            type="button"
                            aria-label="Discard edit"
                            {...gestures(false, quietLift, quietPress)}
                            onClick={() => setEdit(null)}
                          >
                            <CloseIcon />
                          </motion.button>
                        </>
                      ) : (
                        editable && (
                          // Opening one row's box drops whatever another row had in its own.
                          <motion.button
                            className="vu-chatlog-tool"
                            type="button"
                            aria-label="Edit line"
                            {...gestures(false, quietLift, quietPress)}
                            onClick={() => setEdit({ at, text: line.text })}
                          >
                            <PencilIcon />
                          </motion.button>
                        )
                      )}
                    </div>
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

/**
 * A line's words in a box at the log's own size, grown to fit them. It opens with the caret
 * after the last word, where a correction usually starts.
 */
function LineEditBox({
  text,
  onChange
}: {
  text: string
  onChange: (text: string) => void
}): JSX.Element {
  const area = useRef<HTMLTextAreaElement | null>(null)
  useFitToText(area, text, true)

  return (
    <textarea
      ref={area}
      className="vu-input vu-input--multiline vu-input--grow vu-chatlog-edit"
      rows={1}
      aria-label="Line"
      value={text}
      autoFocus
      onFocus={(e) => {
        const end = e.currentTarget.value.length
        e.currentTarget.setSelectionRange(end, end)
      }}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}
