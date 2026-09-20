import { useEffect, useMemo, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { fullNameOf, type Character } from '@shared/types'
import { CharacterJobCard } from '../components/CharacterJobCard'
import { ConfirmModal } from '../components/ConfirmModal'
import { DeadNote } from '../components/DeadNote'
import { DESKTOP_ONLY_NOTE, isWebBuild } from '../platform'
import {
  doneCountOf,
  isInFlight,
  isLockedOf,
  isPregenOf,
  isUnfinished,
  manageOrderOf,
  missingContentPlan,
  useCharacterStore
} from '../stores/characterStore'
import { reshuffleSuggestions } from '../prompts/characterSuggestions'
import { useComfyStore } from '../stores/comfyStore'
import { noNsfwImagesOf, useSettingsStore } from '../stores/settingsStore'
import { useSetupStore } from '../stores/setupStore'
import { useUiStore } from '../stores/uiStore'
import { CharacterModal } from './CharacterModal'
import { EditCharacterModal } from './EditCharacterModal'
import { GenerateCharacterModal } from './GenerateCharacterModal'
import { heldScreenTheme } from './clockTheme'
import {
  breatheMark,
  cardLift,
  dealt,
  dealtItem,
  decorIn,
  fadeIn,
  gestures,
  hovered,
  press,
  pulse,
  quietLift,
  quietPress
} from './motion'
import { BackIcon, DownloadIcon } from './screenIcons'
import '../vu_styles/ManageCharacters.css'

/** The header pill's wording per runtime state, once the install is there. */
const COMFY_PILL = {
  idle: '○ COMFYUI IDLE',
  starting: '◌ COMFYUI STARTING…',
  ready: '● COMFYUI READY',
  error: '● COMFYUI FAILED'
} as const

/** What a confirm calls her, for a character who may have neither name filled in. */
function nameOf(character: Character): string {
  return fullNameOf(character) || 'This character'
}

/**
 * Manage Characters: one grid for existing and in-flight characters, plus
 * local per-character modal state.
 */
export function ManageCharactersView(): JSX.Element {
  const characters = useCharacterStore((s) => s.characters)
  const allOrder = useCharacterStore((s) => s.order)
  const pregenIds = useCharacterStore((s) => s.pregenIds)
  const removedDefaults = useCharacterStore((s) => s.removedDefaults)
  const expressions = useCharacterStore((s) => s.expressions)
  const cgs = useCharacterStore((s) => s.cgs)
  const outfits = useCharacterStore((s) => s.outfits)
  const rooms = useCharacterStore((s) => s.rooms)
  const spriteVersion = useCharacterStore((s) => s.spriteVersion)
  const progress = useCharacterStore((s) => s.progress)
  const loading = useCharacterStore((s) => s.loading)
  const load = useCharacterStore((s) => s.load)
  const generate = useCharacterStore((s) => s.generate)
  const retryGeneration = useCharacterStore((s) => s.retryGeneration)
  const remove = useCharacterStore((s) => s.remove)
  const cancelAllGeneration = useCharacterStore((s) => s.cancelAllGeneration)
  const importCharacter = useCharacterStore((s) => s.importCharacter)
  const restoreDefaults = useCharacterStore((s) => s.restoreDefaults)
  const generateAllMissing = useCharacterStore((s) => s.generateAllMissing)
  const comfyState = useComfyStore((s) => s.state)
  const comfyError = useComfyStore((s) => s.error)
  const comfyDeferred = useSettingsStore((s) => s.settings?.comfyDeferred ?? false)
  const setComfyDeferred = useSettingsStore((s) => s.setComfyDeferred)
  // The room renders in the cloud, so its half of the sweep is gated on the key.
  const apiKeySet = useSettingsStore((s) => s.settings?.apiKeySet ?? false)
  const noNsfwImages = useSettingsStore(noNsfwImagesOf)
  const comfyInstalled = useSetupStore((s) => s.status?.comfyReady ?? false)
  const setView = useUiStore((s) => s.setView)

  const [generating, setGenerating] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [needsComfy, setNeedsComfy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [filling, setFilling] = useState(false)
  const [restoring, setRestoring] = useState(false)

  // Drawn once per visit, from the dev switch or the machine clock.
  const [theme] = useState(heldScreenTheme)

  // Generating first, then the newest write, then the shipped cast — a run in
  // progress is what the player came back to look at, and what he last worked on is
  // what he is likely to want next. A character who has just finished generating is
  // therefore first in the grid, having been written a moment ago.
  const order = useMemo(
    () => manageOrderOf({ characters, order: allOrder, removedDefaults, pregenIds, progress }),
    [characters, allOrder, removedDefaults, pregenIds, progress]
  )

  useEffect(() => {
    // A fresh deck of briefs per visit.
    reshuffleSuggestions()
    void load()
  }, [load])

  const deletingCharacter = deleting ? characters[deleting] : null
  const editingCharacter = editing ? characters[editing] : null
  // A shipped character opens the read-only panel, unless the dev switch is on.
  const editingIsLocked = editing !== null && isLockedOf({ pregenIds }, editing)
  const deletingIsShipped = deleting !== null && isPregenOf({ pregenIds }, deleting)

  // Generation outlives this view, so leaving has to cancel it explicitly.
  const inFlight = order.filter((charId) => isInFlight(progress[charId]))

  // Characters missing a default sprite with nothing running to supply it.
  const unfinished = order.filter(
    (charId) => !isPregenOf({ pregenIds }, charId) && isUnfinished(expressions, progress, charId)
  )

  const leave = (): void => {
    if (inFlight.length > 0) setLeaving(true)
    else setView('mainMenu')
  }

  /** The way to the setup screen. Opting in un-defers, so every boot verifies ComfyUI again. */
  const installComfy = (): void => {
    void setComfyDeferred(false)
    setView('setup')
  }

  // The browser has no local renderer at all, so nothing here offers to install one.
  const webBuild = isWebBuild()

  // Only sprite rendering needs the local install, so this gates the "+" slot.
  const canGenerate = !webBuild && comfyInstalled && !comfyDeferred

  // Every optional set the roster is short of, off the status maps already
  // loaded; a `load()` here would reset every card.
  const gates = { comfyReady: canGenerate, apiKeySet, noNsfwImages }
  const missing = missingContentPlan(
    { characters, order, expressions, cgs, outfits, rooms, progress, pregenIds },
    gates
  )
  const missingImages = missing.reduce((total, entry) => total + entry.missing, 0)
  const missingChars = new Set(missing.map((entry) => entry.charId)).size

  // ComfyUI's state, once there is a state to report: while the install is missing the header
  // offers the install itself rather than a state nothing can act on. Only the two settled
  // states are tinted.
  const comfyTint =
    comfyState === 'ready' || comfyState === 'error' ? ` vu-manage-comfy--${comfyState}` : ''
  const comfyNote =
    canGenerate && comfyState === 'error'
      ? (comfyError?.message ?? 'ComfyUI could not be started.')
      : null

  return (
    <div className="vu-manage" data-theme={theme}>
      {/* The screen's idle: the arch arrives and then breathes, both on the one variant. */}
      <motion.div
        className="vu-manage-decor"
        variants={decorIn}
        initial="hidden"
        animate="shown"
      />

      <motion.header
        className="vu-manage-header"
        variants={fadeIn(0.1)}
        initial="hidden"
        animate="shown"
      >
        <motion.button
          className="vu-circle vu-manage-back"
          aria-label="Main Menu"
          {...gestures(false, quietLift, quietPress)}
          onClick={leave}
        >
          <BackIcon />
        </motion.button>

        <div className="vu-title">
          <h1 className="vu-title-text">Characters</h1>
        </div>

        {webBuild ? null : canGenerate ? (
          <motion.span
            className={`vu-manage-comfy${comfyTint}`}
            animate={comfyState === 'starting' ? pulse : { opacity: 1 }}
          >
            {COMFY_PILL[comfyState]}
          </motion.span>
        ) : (
          <motion.button
            id="manage-install-comfy"
            className="vu-pill vu-manage-install"
            {...gestures(false, quietLift, quietPress)}
            onClick={installComfy}
          >
            Install ComfyUI
          </motion.button>
        )}
        {comfyNote && <span className="vu-manage-comfy-note">{comfyNote}</span>}

        {/* Every action stands at all times and goes dead when it would do nothing, so the
            row never moves and the roster's state is legible from the header alone. None of
            them says why it is dead, as no dead control does. */}
        <div className="vu-manage-actions">
          <motion.button
            id="manage-fill-missing"
            className="vu-pill"
            {...gestures(missing.length === 0, quietLift, quietPress)}
            disabled={missing.length === 0}
            onClick={() => setFilling(true)}
          >
            ✦ Generate missing content
          </motion.button>
          <motion.button
            id="manage-cleanup"
            className="vu-pill vu-manage-pill--danger"
            {...gestures(unfinished.length === 0, quietLift, quietPress)}
            disabled={unfinished.length === 0}
            onClick={() => setCleaning(true)}
          >
            Clean up unfinished
          </motion.button>
          {/* `chars:defaults` intersects the removals with the ids actually present, so
              an empty list is the honest answer and not a dropped folder. */}
          <motion.button
            id="manage-restore-defaults"
            className="vu-pill"
            {...gestures(restoring || removedDefaults.length === 0, quietLift, quietPress)}
            disabled={restoring || removedDefaults.length === 0}
            onClick={() => {
              setRestoring(true)
              void restoreDefaults().finally(() => setRestoring(false))
            }}
          >
            {restoring ? 'Restoring…' : 'Restore default characters'}
          </motion.button>
          {/* The one that always has something to do: dead only while it is doing it. */}
          <motion.button
            id="manage-import"
            className="vu-pill"
            {...gestures(importing, quietLift, quietPress)}
            disabled={importing}
            onClick={() => {
              setImporting(true)
              void importCharacter().finally(() => setImporting(false))
            }}
          >
            <DownloadIcon size={16} />
            {importing ? 'Importing…' : 'Import character ZIP'}
          </motion.button>
        </div>
      </motion.header>

      <div className="vu-manage-body">
        <motion.ul
          className="vu-manage-grid"
          variants={dealt(0.25, 0.04)}
          initial="hidden"
          animate="shown"
        >
          {/* The new-character slot leads the grid, so its position is fixed — dead in the
              browser rather than missing, since the grid it leads is the same grid. */}
          <motion.li className="vu-card vu-manage-card vu-manage-new" variants={dealtItem}>
            <DeadNote note={webBuild ? DESKTOP_ONLY_NOTE : null} align="center">
              <motion.button
                className="vu-card-face"
                aria-label="New character"
                disabled={webBuild}
                {...hovered(webBuild, cardLift)}
                whileTap={webBuild ? undefined : press}
                onClick={() => (canGenerate ? setGenerating(true) : setNeedsComfy(true))}
              >
                <div className="vu-arch vu-manage-arch">
                  <div className="vu-crop vu-card-crop vu-card-crop--empty">
                    {/* The mark breathes: a leaf, so it composes with the deal above it
                        and with the face's own lift. */}
                    <motion.span className="vu-manage-plus" animate={breatheMark}>
                      +
                    </motion.span>
                    <span className="vu-manage-new-label">New character</span>
                  </div>
                </div>
                <div className="vu-card-caption" />
              </motion.button>
            </DeadNote>
          </motion.li>

          {loading && order.length === 0 ? (
            <motion.li className="vu-manage-loading" animate={pulse}>
              LOADING CHARACTERS…
            </motion.li>
          ) : (
            order.map((charId) => (
              <CharacterJobCard
                key={charId}
                character={characters[charId]}
                progress={progress[charId]}
                doneCount={doneCountOf(expressions, charId)}
                spriteVersion={spriteVersion[charId] ?? 0}
                shipped={isPregenOf({ pregenIds }, charId)}
                onClick={() => setEditing(charId)}
                onDelete={() => setDeleting(charId)}
                // Not awaited, for the same reason the first submission is not.
                onRetry={() => void retryGeneration(charId)}
              />
            ))
          )}
        </motion.ul>
        <div className="vu-manage-fade" />
      </div>

      <AnimatePresence>
        {generating && (
          <GenerateCharacterModal
            key="generate"
            theme={theme}
            onClose={() => setGenerating(false)}
            onSubmit={(firstName, lastName, prompt, namesAreSuggestions, options, reference) => {
              setGenerating(false)
              // Not awaited: the pipeline takes minutes and reports itself through the card.
              void generate(firstName, lastName, prompt, namesAreSuggestions, options, reference)
            }}
          />
        )}

        {needsComfy && (
          <ConfirmModal
            key="needs-comfy"
            id="needs-comfy"
            theme={theme}
            title="ComfyUI is not installed"
            message="ComfyUI is required to create characters."
            confirmText="Install"
            onCancel={() => setNeedsComfy(false)}
            onConfirm={() => {
              setNeedsComfy(false)
              installComfy()
            }}
          />
        )}

        {editingCharacter &&
          (editingIsLocked ? (
            <CharacterModal
              key={editingCharacter.charId}
              character={editingCharacter}
              theme={theme}
              library
              onClose={() => setEditing(null)}
            />
          ) : (
            <EditCharacterModal
              key={editingCharacter.charId}
              character={editingCharacter}
              theme={theme}
              onClose={() => setEditing(null)}
            />
          ))}

        {deletingCharacter && (
          <ConfirmModal
            key="delete-character"
            id="delete-character"
            theme={theme}
            title={deletingIsShipped ? 'Remove character?' : 'Delete character?'}
            confirmText={deletingIsShipped ? 'Remove' : undefined}
            message={
              deletingIsShipped
                ? `You can restore ${nameOf(deletingCharacter)} later with the Restore Default Characters button.`
                : `${nameOf(deletingCharacter)} and all generated sprites will be permanently deleted.`
            }
            onCancel={() => setDeleting(null)}
            onConfirm={() => {
              const charId = deletingCharacter.charId
              setDeleting(null)
              if (editing === charId) setEditing(null)
              void remove(charId)
            }}
          />
        )}

        {cleaning && (
          <ConfirmModal
            key="cleanup-unfinished"
            id="cleanup-unfinished"
            theme={theme}
            title="Clean up unfinished characters?"
            message={`${unfinished.length === 1 ? 'One character is' : `${unfinished.length} characters are`} missing expressions and cannot be played. ${unfinished.length === 1 ? 'It' : 'They'} and everything generated for ${unfinished.length === 1 ? 'it' : 'them'} will be permanently deleted. Characters still generating will be left alone.`}
            onCancel={() => setCleaning(false)}
            onConfirm={() => {
              // Recomputed now: a render may have finished a character while the modal was open.
              const doomed = order.filter((charId) => isUnfinished(expressions, progress, charId))
              setCleaning(false)
              if (editing && doomed.includes(editing)) setEditing(null)
              void Promise.all(doomed.map((charId) => remove(charId)))
            }}
          />
        )}

        {filling && (
          <ConfirmModal
            key="fill-missing"
            id="fill-missing"
            theme={theme}
            title="Generate missing content?"
            message={`${missing.length === 1 ? 'One set is' : `${missing.length} sets are`} incomplete across ${missingChars === 1 ? 'one character' : `${missingChars} characters`}, totalling ${missingImages === 1 ? 'one image' : `${missingImages} images`}. Only what is missing will be generated. Anything already generated or still generating won't be affected.`}
            confirmText="Generate"
            onCancel={() => setFilling(false)}
            onConfirm={() => {
              setFilling(false)
              // The store recomputes the list: a bucket may have landed while the modal was open.
              generateAllMissing(gates)
            }}
          />
        )}

        {leaving && (
          <ConfirmModal
            key="leave-manage"
            id="leave-manage"
            theme={theme}
            title="Leave and cancel generation?"
            message={`${inFlight.length === 1 ? 'One character is' : `${inFlight.length} characters are`} still generating. Current generations will be cancelled, and progress will be saved.`}
            confirmText="Leave"
            busy={cancelling}
            busyText="Cancelling…"
            onCancel={() => setLeaving(false)}
            onConfirm={() => {
              // Navigate only once the cancels have settled, or a mid-write sprite is left half-saved.
              setCancelling(true)
              void cancelAllGeneration().finally(() => {
                setCancelling(false)
                setLeaving(false)
                setView('mainMenu')
              })
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
