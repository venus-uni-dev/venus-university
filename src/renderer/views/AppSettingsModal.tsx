import { useEffect, useState, type CSSProperties, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { VOLUME_MAX, VOLUME_MIN, volumesOf, type AudioGroup, type Volumes } from '@shared/audio'
import {
  THINKING_LEVEL_LABELS,
  defaultModelFor,
  modelFor,
  providerFor,
  thinkingLevelFor
} from '@shared/providers'

import type { ThinkingLevel } from '@shared/providers'
import type { PromptKind } from '@shared/promptKinds'
import type { Settings, SettingsPatch } from '@shared/types'
import { ConfirmModal } from '../components/ConfirmModal'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { SelectField } from '../components/SelectField'
import { CheckField } from '../components/CheckField'
import { SfwCheckList } from '../components/SfwCheckList'
import { isWebBuild } from '../platform'
import { useSettingsStore } from '../stores/settingsStore'
import { useAudioStore } from '../stores/audioStore'
import { useUiStore } from '../stores/uiStore'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import { sfwValuesOf, type SfwKey } from './sfwFields'
import { VOLUME_FIELDS } from './volumeFields'
import { PROMPT_KIND_FIELDS, promptKindValuesOf, promptKindsFrom } from './promptKindFields'
import '../vu_styles/Settings.css'

export interface AppSettingsModalProps {
  /** Drawn by whatever opened this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
  /**
   * How this closes, for the one caller that does not open it through the modal stack: the Game
   * View holds it as an arm of its own `OpenPanel`, so that `blocked` covers it and Enter cannot
   * reach the line behind it. Absent is the menu's own route, which closes the stack.
   */
  onClose?: () => void
}

/**
 * Settings as opened from the Main Menu and the Game View's gear icon.
 * Provider/model options come only from `providers.ts`.
 */
export function AppSettingsModal({ theme, onClose }: AppSettingsModalProps): JSX.Element | null {
  const settings = useSettingsStore((s) => s.settings)
  const saving = useSettingsStore((s) => s.saving)
  const save = useSettingsStore((s) => s.save)
  const exportBackup = useSettingsStore((s) => s.exportBackup)
  const importBackup = useSettingsStore((s) => s.importBackup)
  const closeModal = useUiStore((s) => s.closeModal)
  const close = onClose ?? ((): void => closeModal('settings'))

  // Edits are staged locally, so closing without saving discards them. `modelFor`
  // resolves through the provider table, so the select opens on one of its own options.
  const [apiModel, setApiModel] = useState(() =>
    settings ? modelFor(settings.apiProvider, settings.apiModel).id : ''
  )
  const [thinkingLevel, setThinkingLevel] = useState(() =>
    settings
      ? thinkingLevelFor(settings.apiProvider, settings.apiModel, settings.thinkingLevel)
      : defaultModelFor('gemini').defaultThinkingLevel
  )
  const [secondaryModel, setSecondaryModel] = useState(() => settings?.secondaryModel ?? '')
  // Staged as one record, exactly as the content switches are; absent on the record means all three.
  const [secondaryFor, setSecondaryFor] = useState<Record<PromptKind, boolean>>(() =>
    promptKindValuesOf(settings)
  )
  // Staged as one record, rendered from `SFW_FIELDS`.
  const [sfw, setSfw] = useState<Record<SfwKey, boolean>>(() =>
    settings
      ? sfwValuesOf(settings)
      : { noNsfwImages: false, lessNsfwText: false, noNsfwSound: false }
  )
  // Staged as one record, and heard while it is staged: each change is handed to the mix.
  const [volumes, setVolumes] = useState<Volumes>(() => volumesOf(settings?.volumes))
  // The key is the exception: the renderer is never told it, so the field
  // opens blank and a blank one on save means "keep what is stored".
  const [apiKey, setApiKey] = useState('')
  // Only the browser keeps a key anywhere the player might not want it kept.
  const [remember, setRemember] = useState(settings?.rememberKey === true)
  // What a restore is doing, so the two buttons are dead while one of them is working.
  const [backingUp, setBackingUp] = useState(false)
  const [restoring, setRestoring] = useState(false)
  // Whether the gate in front of a restore is up: it writes over everything already here.
  const [confirmRestore, setConfirmRestore] = useState(false)

  // Whatever is stored is what plays once this closes, read at that moment so a save
  // that has just landed is what comes back and every other way out undoes the drag.
  useEffect(
    () => () =>
      useAudioStore
        .getState()
        .setLiveVolumes(volumesOf(useSettingsStore.getState().settings?.volumes)),
    []
  )

  const { host, overlayProps } = useModalShell(close)
  if (!host || !settings) return null

  // **Not staged, because nothing on this screen changes it**: one provider ships, so the
  // stored one is what every lookup below and the patch itself are read against.
  const apiProvider: Settings['apiProvider'] = settings.apiProvider

  // Where the key and the whole of the player's data live in the browser's own storage.
  const webBuild = isWebBuild()

  // Off that provider, so a select never holds another provider's model.
  const models = providerFor(apiProvider).models
  // Likewise off the staged model: which levels are accepted is a per-model fact.
  const thinkingLevels = modelFor(apiProvider, apiModel).thinkingLevels

  function handleModelChange(value: string): void {
    setApiModel(value)
    // Re-resolved against the new model's accepted levels.
    setThinkingLevel(thinkingLevelFor(apiProvider, value, thinkingLevel))
  }

  /** A group's slider: staged like every other field, and handed to the mix so it is heard. */
  function handleVolumeChange(key: AudioGroup, value: number): void {
    const next: Volumes = { ...volumes, [key]: value }
    setVolumes(next)
    useAudioStore.getState().setLiveVolumes(next)
  }

  async function handleSave(): Promise<void> {
    if (!settings) return
    const patch: SettingsPatch = {
      apiProvider,
      apiModel,
      thinkingLevel,
      secondaryModel,
      // Nothing is routed while no second model is picked, so nothing is stored for it.
      secondaryModelFor: secondaryModel ? promptKindsFrom(secondaryFor) : [],
      comfyDeferred: settings.comfyDeferred,
      ...sfw,
      // Answering the two here answers the boot question too.
      sfwAsked: true,
      rememberKey: remember,
      volumes
    }
    // Only a field the player actually typed into replaces the stored key.
    if (apiKey.trim()) patch.apiKey = apiKey.trim()

    const ok = await save(patch)
    if (ok) close()
  }

  return createPortal(
    <>
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
          id="settings-modal"
          className="vu-settings vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label="Settings"
          variants={panelUnderTab}
        >
          <TitleTab>Settings</TitleTab>

          <div className="vu-settings-writer">
            <span className="vu-settings-heading">Generation</span>

            {/* No provider picker: one provider ships, and a closed set of one is not a
                question. Everything behind it is untouched — `providers.ts` still answers
                which models and levels exist, and the patch still carries the provider. */}
            <SelectField
              id="settings-model"
              label="Model"
              hint="The default model (Gemini 3.6) is recommended for free-tier keys. The latest model is recommended for paid keys. Downgrade the model version if you are running into connection errors. Using Flash Lite for the primary model is highly discouraged."
              value={apiModel}
              onChange={handleModelChange}
              options={models.map((model) => ({ value: model.id, label: model.label }))}
            />

            <SelectField
              id="settings-thinking-level"
              label="Thinking"
              hint="Recommended to be left at Low. Only 3.6 and older models support Minimal effort. Certain calls run with High thinking level no matter what is set here."
              value={thinkingLevel}
              onChange={(value) => setThinkingLevel(value as ThinkingLevel)}
              options={thinkingLevels.map((level) => ({
                value: level,
                label: THINKING_LEVEL_LABELS[level]
              }))}
            />

            {/* A cheaper model for the calls that can take one. The list of what it writes
                is absent until there is a model to write anything, rather than dead. */}
            <SelectField
              id="settings-secondary-model"
              label="Secondary model"
              hint="Use a low-power model for less important calls. Set this to None for max quality if cost is not a concern."
              value={secondaryModel}
              onChange={setSecondaryModel}
              options={[
                { value: '', label: 'None (Use one model for everything)' },
                ...models.map((model) => ({ value: model.id, label: model.label }))
              ]}
            />

            {secondaryModel && (
              <div className="vu-settings-kinds">
                <span className="vu-settings-kinds-head">Use it for</span>
                {PROMPT_KIND_FIELDS.map((field) => (
                  <CheckField
                    key={field.key}
                    id={field.id}
                    label={field.label}
                    meta={field.note}
                    checked={secondaryFor[field.key]}
                    onChange={(checked) =>
                      setSecondaryFor((current) => ({ ...current, [field.key]: checked }))
                    }
                  />
                ))}
              </div>
            )}

            {/* The field always opens blank — the renderer holds only `apiKeySet` — so the
                placeholder is what carries the state. */}
            <label className="vu-field vu-settings-key" htmlFor="settings-api-key">
              <span className="vu-field-label">API key</span>
              <input
                id="settings-api-key"
                className="vu-input"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  settings.apiKeySet
                    ? 'Leave blank to keep your saved key'
                    : 'Required. Please generate one if you don\'t have one already.'
                }
              />
            </label>

            {webBuild && (
              <CheckField
                id="settings-remember-key"
                label="Remember my key on this device"
                note="By default, your key will be deleted every session. Enabling this setting will save your key in browser storage so you won't have to type it in again next time. Warning: other itch.io games will be able to read your key."
                checked={remember}
                onChange={setRemember}
              />
            )}
          </div>

          <div className="vu-settings-content">
            <span className="vu-settings-heading">Content</span>

            {/* Each toggle carries what turning it on costs; the note is the whole of what the
                app promises about either setting. */}
            <SfwCheckList sfw={sfw} setSfw={setSfw} />

            <span className="vu-settings-heading vu-settings-sound-heading">Sound</span>

            {/* Each slider is heard while it is dragged and only written at Save. */}
            <div className="vu-settings-sound">
              {VOLUME_FIELDS.map((field) => (
                <div className="vu-range-row" key={field.key}>
                  <span className="vu-range-label">{field.label}</span>
                  <input
                    id={field.id}
                    className="vu-range"
                    type="range"
                    min={VOLUME_MIN}
                    max={VOLUME_MAX}
                    step={1}
                    value={volumes[field.key]}
                    aria-label={field.label}
                    aria-valuetext={`${volumes[field.key]} percent`}
                    style={{ '--range-fill': `${volumes[field.key]}%` } as CSSProperties}
                    onChange={(e) => handleVolumeChange(field.key, Number(e.target.value))}
                  />
                  <span className="vu-range-reading">{volumes[field.key]}%</span>
                </div>
              ))}
            </div>

            {/* One zip of everything this build keeps, and one read back over it. Both builds
                write the same format, so a semester started in one goes on in the other. */}
            <span className="vu-settings-heading vu-settings-data-heading">Game data</span>
            <div className="vu-settings-data">
              <div className="vu-settings-data-actions">
                <motion.button
                  id="settings-backup-export"
                  className="vu-pill"
                  type="button"
                  disabled={backingUp || restoring}
                  {...gestures(backingUp || restoring, quietLift, quietPress)}
                  onClick={() => {
                    setBackingUp(true)
                    void exportBackup().finally(() => setBackingUp(false))
                  }}
                >
                  {backingUp ? 'Backing up…' : 'Back up game data'}
                </motion.button>
                <motion.button
                  id="settings-backup-import"
                  className="vu-pill"
                  type="button"
                  disabled={backingUp || restoring}
                  {...gestures(backingUp || restoring, quietLift, quietPress)}
                  onClick={() => setConfirmRestore(true)}
                >
                  {restoring ? 'Restoring…' : 'Restore from backup'}
                </motion.button>
              </div>
              <span className="vu-check-note">
                {webBuild
                  ? "Web saves live in browser storage and can be accidentally wiped. It's highly recommended to regularly back up your saves."
                  : 'Saves are stored on disk in the data folder. "Back up game data" exports them as a portable zip file for transfer.'}
              </span>
            </div>

            <div className="vu-foot vu-settings-foot">
              <motion.button
                id="settings-cancel"
                className="vu-btn vu-btn--quiet"
                type="button"
                disabled={saving}
                {...gestures(saving, quietLift, quietPress)}
                onClick={close}
              >
                Cancel
              </motion.button>
              <motion.button
                id="settings-save"
                className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
                type="button"
                disabled={saving}
                {...gestures(saving, lift, press)}
                onClick={() => void handleSave()}
              >
                {saving ? 'Saving…' : 'Save settings'}
              </motion.button>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* Siblings of the veil, not children: a click inside one does not reach the veil's
          own handler through the React tree. */}
      <AnimatePresence propagate>
        {confirmRestore && (
          <ConfirmModal
            key="restore"
            id="settings-restore-confirm"
            theme={theme}
            title="Restore from backup?"
            message="All saves, settings, and characters will be overwritten. You may want to create a backup beforehand, just in case."
            confirmText="Restore"
            cancelText="Cancel"
            onCancel={() => setConfirmRestore(false)}
            onConfirm={() => {
              setConfirmRestore(false)
              setRestoring(true)
              void importBackup().finally(() => setRestoring(false))
            }}
          />
        )}
      </AnimatePresence>
    </>,
    host
  )
}
