import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { SfwCheckList } from '../components/SfwCheckList'
import { patchOf, useSettingsStore } from '../stores/settingsStore'
import type { ScreenTheme } from './clockTheme'
import { gestures, lift, panelUnderTab, press, veilIn } from './motion'
import type { SfwKey } from './sfwFields'
import '../vu_styles/Settings.css'

export interface SfwPromptModalProps {
  /** Drawn by the screen that raises it — a portal inherits neither palette nor state rules. */
  theme: ScreenTheme
  /**
   * How this closes, for the screen that raises it rather than the modal stack: the setup
   * screen holds it as the last stage of a first run and leaves for the menu behind it.
   */
  onClose: () => void
}

/**
 * The content question, asked once, at the end of the first run, on a ground with nothing else
 * on it. Escape and the dimming are Continue through the shell.
 */
export function SfwPromptModal({ theme, onClose }: SfwPromptModalProps): JSX.Element | null {
  const settings = useSettingsStore((s) => s.settings)
  const saving = useSettingsStore((s) => s.saving)
  const save = useSettingsStore((s) => s.save)

  const [sfw, setSfw] = useState<Record<SfwKey, boolean>>({
    noNsfwImages: false,
    lessNsfwText: false,
    noNsfwSound: false
  })

  async function handleContinue(): Promise<void> {
    if (!settings) return
    const ok = await save({ ...patchOf(settings), ...sfw, sfwAsked: true })
    // A failed write leaves the modal up; the store has already raised the error.
    if (!ok) return
    onClose()
  }

  const { host, overlayProps } = useModalShell(() => void handleContinue())
  if (!host) return null
  if (!settings) return null

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
        id="sfw-prompt"
        className="vu-settings vu-settings--content vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Content settings"
        variants={panelUnderTab}
      >
        <TitleTab>Content settings</TitleTab>

        <div className="vu-settings-content">
          <p className="vu-settings-intro">
            Explicit content is optional and can be toggled below or in Settings.
          </p>

          <SfwCheckList sfw={sfw} setSfw={setSfw} />

          <div className="vu-foot vu-settings-foot">
            <motion.button
              id="sfw-prompt-continue"
              className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
              type="button"
              disabled={saving}
              {...gestures(saving, lift, press)}
              onClick={() => void handleContinue()}
            >
              {saving ? 'Saving…' : 'Continue'}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
