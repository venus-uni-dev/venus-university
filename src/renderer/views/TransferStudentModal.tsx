/**
 * The transfer students waiting for the next timeslot, each by face and name with a Cancel, those
 * being generated standing after them under a ring, and the way to add another: the picker, then
 * the ask, then the wait on her row. Generations outlive the sheet, so the first failure among
 * them is raised whenever the sheet is open, and by the Game View's own host otherwise.
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { firstNameKeyOf } from '@shared/characterRules'
import { EMOTIONS } from '@shared/emotions'
import { fullNameOf, type Character } from '@shared/types'
import { CardCaption } from '../components/CardCaption'
import { CheckField } from '../components/CheckField'
import { LlmFailureModal } from '../components/LlmFailureModal'
import { TitleTab } from '../components/TitleTab'
import { useModalShell } from '../components/useModalShell'
import {
  profileUrl,
  spriteUrl,
  useCharacterStore,
  useSpriteVersion
} from '../stores/characterStore'
import {
  abandonTransfer,
  cancelPendingTransfer,
  firstFailedTransfer,
  retryTransfer,
  startTransfer,
  transferCharacterOf,
  transferFailedPrompt,
  transferFailureOffersEdit,
  transferOffer,
  transferRoom
} from '../stores/gameLoop'
import { useGameStore } from '../stores/gameStore'
import type { ScreenTheme } from './clockTheme'
import { EditPromptModal } from './EditPromptModal'
import { useWarmedImages } from './imagePreload'
import { LoadCharacterModal } from './LoadCharacterModal'
import {
  dealt,
  gestures,
  lift,
  panelUnderTab,
  press,
  quietLift,
  quietPress,
  slideInQuick,
  spin,
  veilIn
} from './motion'
import '../vu_styles/TransferStudent.css'

/** The rows arrive with the panel, so they take the quicker step. */
const ROW_DEAL = dealt(0, 0.04)

/** What stands over the sheet on the way to a new transfer: the picker, or the ask after it. */
type Step = { kind: 'picking' } | { kind: 'asking'; character: Character }

/** Where one girl on the list stands: waiting to arrive, being generated, or stopped by a failure. */
type RowState = 'waiting' | 'generating' | 'failed'

/** One row of the list: who she is, and where she stands. */
interface Row {
  character: Character
  state: RowState
}

export interface TransferStudentModalProps {
  /** Drawn by the screen that opened this — a portal inherits neither palette nor state rules. */
  theme: ScreenTheme
  onClose: () => void
}

/** The transfer students' sheet, opened from the Game menu on a landing. */
export function TransferStudentModal({
  theme,
  onClose
}: TransferStudentModalProps): JSX.Element | null {
  const chars = useGameStore((s) => s.chars)
  const alumni = useGameStore((s) => s.alumni)
  const characters = useGameStore((s) => s.characters)
  const pending = useGameStore((s) => s.pendingTransfers)
  const pendingCharacters = useGameStore((s) => s.pendingCharacters)
  const jobs = useGameStore((s) => s.transferJobs)
  const library = useCharacterStore((s) => s.characters)
  const expressions = useCharacterStore((s) => s.expressions)

  const [step, setStep] = useState<Step | null>(null)

  // The picker lists the characters on disk.
  useEffect(() => {
    void useCharacterStore.getState().load()
  }, [])

  const open = transferOffer() === 'open'
  // Redrawn as a generation starts or is given up, the jobs being subscribed above.
  const addDead = !open || transferRoom() <= 0

  // Everyone waiting, then everyone being generated in the order picked, each one's row becoming
  // her waiting one as she lands.
  const rows = useMemo<Row[]>(() => {
    const waiting = pending.flatMap((entry): Row[] => {
      const character = pendingCharacters[entry.charId]
      return character ? [{ character, state: 'waiting' }] : []
    })
    const listed = new Set(pending.map((entry) => entry.charId))
    const generating = Object.entries(jobs).flatMap(([charId, job]): Row[] => {
      const character = transferCharacterOf(charId) ?? library[charId]
      if (!character || listed.has(charId)) return []
      return [{ character, state: job.phase === 'failed' ? 'failed' : 'generating' }]
    })
    return [...waiting, ...generating]
  }, [pending, pendingCharacters, jobs, library])

  // Dimmed in the picker: the roster, its graduates, everyone waiting or being generated, and
  // every character sharing a first name with any of them.
  const taken = useMemo(() => {
    const ids = new Set([
      ...chars,
      ...alumni,
      ...pending.map((entry) => entry.charId),
      ...Object.keys(jobs)
    ])
    const keys = new Set<string>()
    for (const charId of ids) {
      const character =
        characters[charId] ??
        pendingCharacters[charId] ??
        transferCharacterOf(charId) ??
        library[charId]
      if (character) keys.add(firstNameKeyOf(character))
    }
    return Object.values(library)
      .filter((character) => ids.has(character.charId) || keys.has(firstNameKeyOf(character)))
      .map((character) => character.charId)
  }, [chars, alumni, pending, jobs, characters, pendingCharacters, library])

  // The picker mounts one sprite per finished character at once, so they are decoded first.
  const pickerUrls = useMemo(
    () =>
      Object.keys(library)
        .filter((charId) => EMOTIONS.every((emotion) => expressions[charId]?.[emotion]))
        .map((charId) => spriteUrl(charId, 'neutral')),
    [library, expressions]
  )
  useWarmedImages(pickerUrls, !addDead)

  const failed = firstFailedTransfer(jobs)

  const { host, overlayProps } = useModalShell(onClose)
  if (!host) return null

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
          id="transfer"
          className="vu-sheet vu-transfer vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label="Transfer students"
          variants={panelUnderTab}
        >
          <TitleTab>Transfer students</TitleTab>

          {rows.length === 0 ? (
            <p className="vu-empty">No transfer students waiting.</p>
          ) : (
            <div className="vu-scroll-box">
              <motion.ul className="vu-rows vu-transfer-rows" variants={ROW_DEAL}>
                {rows.map(({ character, state }) => (
                  <TransferRow
                    key={character.charId}
                    character={character}
                    state={state}
                    // A row being generated gives the generation up; a waiting one is taken off
                    // the list only while the landing holds.
                    dead={state === 'waiting' && !open}
                    onCancel={() =>
                      state === 'waiting'
                        ? cancelPendingTransfer(character.charId)
                        : abandonTransfer(character.charId)
                    }
                  />
                ))}
              </motion.ul>
              <div className="vu-scroll-fade" />
            </div>
          )}

          <div className="vu-foot">
            <motion.button
              id="transfer-close"
              className="vu-btn vu-btn--quiet"
              type="button"
              {...gestures(false, quietLift, quietPress)}
              onClick={onClose}
            >
              Close
            </motion.button>
            <motion.button
              id="transfer-add"
              className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
              type="button"
              disabled={addDead}
              {...gestures(addDead, lift, press)}
              onClick={() => setStep({ kind: 'picking' })}
            >
              Add a transfer student
            </motion.button>
          </div>
        </motion.div>
      </motion.div>

      {/* The picker and the ask follow one another, so one leaves before the other arrives. */}
      <AnimatePresence mode="wait" propagate>
        {step?.kind === 'picking' && (
          <LoadCharacterModal
            key="picker"
            taken={taken}
            theme={theme}
            onClose={() => setStep(null)}
            onPick={(character) => setStep({ kind: 'asking', character })}
          />
        )}
        {step?.kind === 'asking' && (
          <TransferAskModal
            key="ask"
            theme={theme}
            character={step.character}
            dead={addDead}
            onBack={() => setStep({ kind: 'picking' })}
            onTransfer={(skip) => {
              setStep(null)
              void startTransfer(step.character, skip)
            }}
          />
        )}
      </AnimatePresence>

      {/* The first generation that failed, raised whenever the sheet is open on it. */}
      <TransferFailure theme={theme} charId={failed} propagate />
    </>,
    host
  )
}

/**
 * The failure that stopped `charId`'s generation, with Retry, Edit prompt where her failed call
 * has a prompt and Cancel, and the prompt editor Edit prompt opens; nothing while `charId` is
 * null or her generation stands. A re-roll answers the permanent validators as well, so Retry
 * stands whatever the code says.
 */
export function TransferFailure({
  theme,
  charId,
  propagate = false
}: {
  theme: ScreenTheme
  charId: string | null
  /** Leaves with the sheet it is raised over. */
  propagate?: boolean
}): JSX.Element {
  const job = useGameStore((s) => (charId ? s.transferJobs[charId] : undefined))
  const failure = job?.phase === 'failed' ? job.error : null
  const first = charId ? transferCharacterOf(charId)?.firstName : undefined
  /** The girl whose prompt is being edited, so the editor never outlives her failure. */
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <>
      {/* One girl's failure leaves before the next one's is raised. */}
      <AnimatePresence mode="wait" propagate={propagate}>
        {charId && failure && (
          <LlmFailureModal
            key={charId}
            id="transfer-failed"
            theme={theme}
            error={failure}
            title={first ? `Couldn't add ${first} as a transfer student` : "Couldn't add the transfer student"}
            retryMessage="You can try again, or cancel the transfer."
            cancelText="Cancel"
            alwaysRetryable
            extraText={transferFailureOffersEdit(charId) ? 'Edit prompt' : undefined}
            onExtra={() => setEditing(charId)}
            onRetry={() => void retryTransfer(charId)}
            onAbandon={() => abandonTransfer(charId)}
          />
        )}
      </AnimatePresence>

      {/* The prompt editor, held to the failure still standing: sending clears it, and an
          answered failure must not leave the editor behind. */}
      <AnimatePresence propagate={propagate}>
        {charId && failure && editing === charId && (
          <EditPromptModal
            key="edit-prompt"
            id="transfer-edit-prompt"
            theme={theme}
            hint={
              <>
                If the model is refusing to write due to prohibited content, try rewording the
                character&apos;s description first. Avoid any explicit sexual words, replacing them
                with vague descriptions.
                <br /> Only what is sent changes: the character sheet stays as it is.
              </>
            }
            initialPrompt={transferFailedPrompt(charId)?.user ?? ''}
            onSubmit={(prompt) => {
              setEditing(null)
              void retryTransfer(charId, prompt)
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}

/** One transfer student: her face, her name over where she stands, and her Cancel. */
function TransferRow({
  character,
  state,
  dead,
  onCancel
}: {
  character: Character
  state: RowState
  dead: boolean
  onCancel: () => void
}): JSX.Element {
  const version = useSpriteVersion(character.charId)
  const name = fullNameOf(character)

  return (
    <motion.li className="vu-row vu-transfer-row" variants={slideInQuick}>
      <span className="vu-arch vu-transfer-face">
        <span className="vu-crop">
          <img className="vu-crop-img" src={profileUrl(character.charId, version)} alt="" />
        </span>
      </span>
      <span className="vu-transfer-who">
        <span className="vu-transfer-name">{name}</span>
        <span
          className={`vu-transfer-state${state === 'failed' ? ' vu-transfer-state--failed' : ''}`}
        >
          {state === 'generating' && <motion.span className="vu-ring" animate={spin} />}
          {state === 'generating'
            ? 'Generating…'
            : state === 'failed'
              ? 'Generation failed'
              : 'Arrives next timeslot'}
        </span>
      </span>
      <motion.button
        id={`transfer-cancel-${character.charId}`}
        className="vu-btn vu-btn--quiet vu-transfer-cancel"
        type="button"
        aria-label={`Cancel ${name}'s transfer`}
        disabled={dead}
        {...gestures(dead, quietLift, quietPress)}
        onClick={onCancel}
      >
        Cancel
      </motion.button>
    </motion.li>
  )
}

/**
 * The ask after a pick: who she is, when she arrives, and whether the LLM writes her major,
 * profile and secrets or the setting's lists deal them. Enter answers with Transfer, which
 * answers once.
 */
function TransferAskModal({
  theme,
  character,
  dead,
  onBack,
  onTransfer
}: {
  theme: ScreenTheme
  character: Character
  /** The landing stopped holding, or the roster filled, since the picker opened. */
  dead: boolean
  onBack: () => void
  onTransfer: (skip: boolean) => void
}): JSX.Element | null {
  const [skip, setSkip] = useState(false)
  const version = useSpriteVersion(character.charId)
  const sent = useRef(false)
  const first = character.firstName || fullNameOf(character)

  /** Sends the transfer the first time it is asked for, and never again. */
  function transfer(): void {
    if (dead || sent.current) return
    sent.current = true
    onTransfer(skip)
  }

  const { host, overlayProps, primaryProps } = useModalShell(onBack, 'panel', transfer)
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
        id="transfer-ask"
        className="vu-note vu-transfer-ask vu-paper"
        role="dialog"
        aria-modal="true"
        aria-label="Transfer student"
        variants={panelUnderTab}
        {...primaryProps}
      >
        <TitleTab>Transfer student</TitleTab>

        <div className="vu-transfer-ask-body">
          <div className="vu-card vu-transfer-card">
            <div className="vu-card-face">
              <span className="vu-arch vu-transfer-arch vu-paper">
                <span className="vu-crop">
                  <img className="vu-crop-img" src={profileUrl(character.charId, version)} alt="" />
                </span>
              </span>
              <CardCaption character={character} />
            </div>
          </div>

          <div className="vu-transfer-ask-text">
            <p className="vu-note-text">
              {first} will arrive at the start of the next timeslot.
            </p>
            <CheckField
              id="transfer-ask-skip"
              label="Skip LLM generation"
              note={`${first}'s major, profile, classes and secrets will be randomly selected from a pre-defined pool based on the VU setting.`}
              checked={skip}
              onChange={setSkip}
            />
          </div>
        </div>

        <div className="vu-foot vu-note-foot">
          <motion.button
            id="transfer-ask-back"
            className="vu-btn vu-btn--quiet"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={onBack}
          >
            Back
          </motion.button>
          <motion.button
            id="transfer-ask-confirm"
            className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
            type="button"
            disabled={dead}
            {...gestures(dead, lift, press)}
            onClick={transfer}
          >
            Transfer
          </motion.button>
        </div>
      </motion.div>
    </motion.div>,
    host
  )
}
