import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, type AnimationPlaybackControls } from 'motion/react'
import { toAppError } from '@shared/errors'
import {
  AUTOSAVE_ID,
  MAX_SLOT_SAVES,
  fullNameOf,
  type AppError,
  type Character,
  type GameSave,
  type PlaythroughRecord,
  type PlaythroughSummary
} from '@shared/types'
import { ConfirmModal } from '../components/ConfirmModal'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { formatDateBanner } from '../prompts/gameDate'
import { GOODBYES_SAVE_LABEL } from '../prompts/graduation'
import { profileUrl, useCharacterStore } from '../stores/characterStore'
import { beginCrossing, coverSwap, endCrossing, useCrossingStore } from '../stores/crossingStore'
import {
  enterGame,
  hasDecisionPoint,
  leaveToMenu,
  prepareGameServices,
  switchGame
} from '../stores/gameLoop'
import { stageEnrollment } from '../stores/newGame'
import {
  castOf,
  unloadableReason,
  useSaveStore,
  type ResolvedSave
} from '../stores/saveStore'
import { entryCrossing, menuCrossing } from '../stores/slotCrossing'
import { useUiStore } from '../stores/uiStore'
import {
  dealt,
  gestures,
  lift,
  panelUnderTab,
  peek,
  press,
  quietLift,
  quietPress,
  rowLift,
  rowPress,
  slideIn,
  tuck,
  tweenSize,
  veilIn
} from './motion'
import { CloseIcon } from './screenIcons'
import '../vu_styles/LoadGame.css'

export interface LoadGameModalProps {
  /** Drawn by whatever opened this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
  /**
   * How this instance is dismissed and how a load hands off. Absent, it closes the app-level
   * modal and a load enters through the Main Menu's crossing. Present, it closes through the
   * caller — the Game menu's `OpenPanel` arm — and a load runs {@link switchGame} instead.
   */
  onClose?: () => void
}

/** A save on its way in, held with the service warm-up it is waiting on. */
interface Entering {
  save: GameSave
  record: PlaythroughRecord
  characters: Character[]
  ready: Promise<void>
}

/** When a file was written, in the machine's own locale. */
function writtenAt(savedAt: number): string {
  return new Date(savedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

/**
 * Load Game, in two levels on one panel: every playthrough in creation order, then the saves
 * inside the one picked, newest first with its own load gate per save.
 */
export function LoadGameModal({ theme, onClose }: LoadGameModalProps): JSX.Element | null {
  const playthroughs = useSaveStore((s) => s.playthroughs)
  const characters = useSaveStore((s) => s.characters)
  const selected = useSaveStore((s) => s.selected)
  const saves = useSaveStore((s) => s.saves)
  const loading = useSaveStore((s) => s.loading)
  const loaded = useSaveStore((s) => s.loaded)
  const loadPlaythroughs = useSaveStore((s) => s.loadPlaythroughs)
  const open = useSaveStore((s) => s.open)
  const back = useSaveStore((s) => s.back)
  const removeSave = useSaveStore((s) => s.removeSave)
  const removePlaythrough = useSaveStore((s) => s.removePlaythrough)
  const resolveEnrollment = useSaveStore((s) => s.resolveEnrollment)
  const closeModal = useUiStore((s) => s.closeModal)
  const setView = useUiStore((s) => s.setView)
  const setMenuTheme = useUiStore((s) => s.setMenuTheme)
  const showError = useUiStore((s) => s.showError)

  // **This modal is the one the curtain goes over**: the crossing into a game starts here,
  // and a panel standing on top of the sheet that is covering the stage for it is a hole in the
  // cover. Every other modal keeps opening above the curtain.
  const covered = useCrossingStore((s) => s.phase !== 'idle')

  const [deletingSave, setDeletingSave] = useState<ResolvedSave | null>(null)
  const [deletingPlaythrough, setDeletingPlaythrough] = useState<PlaythroughSummary | null>(null)
  // The save waiting on the player's yes, when a game is already running.
  const [confirmingLoad, setConfirmingLoad] = useState<ResolvedSave | null>(null)
  // And the semester waiting on it, which is the same question about a registrar.
  const [confirmingResume, setConfirmingResume] = useState<PlaythroughSummary | null>(null)
  // Captured with the promise so the hand-off uses the roster on screen at the click.
  const [entering, setEntering] = useState<Entering | null>(null)
  // Which row is under the cursor: the ✕ is revealed from React rather than by CSS.
  const [hovered, setHovered] = useState<string | null>(null)
  // Whether the panel is the size of what is in it, and the list may deal itself out.
  const [settled, setSettled] = useState(true)

  const panel = useRef<HTMLDivElement>(null)
  // The panel's height at rest, read after every commit that is not mid-resize.
  const measured = useRef(0)
  const resize = useRef<AnimationPlaybackControls | null>(null)

  /**
   * What the panel is showing: the two levels, and the read between them. Keyed on the
   * playthrough as well as the level, so opening a second one resizes again rather than
   * reading as the same content.
   */
  const stage = selected ? (loading ? 'loading' : selected.playthroughId) : 'root'
  const previous = useRef(stage)

  useEffect(() => {
    void loadPlaythroughs()
  }, [loadPlaythroughs])

  /**
   * One panel serves both levels, so it grows and shrinks rather than being replaced: the height
   * is held while the folder is read, then tweened to what the new rows need (`tweenSize`).
   * **No dependency array** — every render re-measures the resting height, which is what the
   * next switch tweens *from*.
   */
  useLayoutEffect(() => {
    const node = panel.current
    if (!node) return

    if (previous.current === stage) {
      if (!resize.current) measured.current = node.offsetHeight
      return
    }
    previous.current = stage
    resize.current?.stop()
    resize.current = null

    const from = measured.current || node.offsetHeight

    // Reading the folder: hold the height the rows just left, or the panel collapses onto
    // its empty body and springs back open a frame later.
    if (stage === 'loading') {
      node.style.height = `${from}px`
      return
    }

    node.style.height = ''
    const to = node.offsetHeight
    if (to === from) {
      setSettled(true)
      return
    }

    resize.current = tweenSize(
      (value) => {
        node.style.height = value
      },
      from,
      to,
      () => {
        resize.current = null
        measured.current = to
        setSettled(true)
      }
    )
  })

  /** The cover up and the save handed off under it: the click's body, once the player has said yes. */
  function load(entry: ResolvedSave): void {
    // Neither half loads without the other.
    if (!entry.save || !entry.record) return
    // The cover goes up on the click and the game is hydrated under it, wearing the hour the
    // save is set in rather than the panel's. A refused cover — only reachable from the Game
    // menu, when a game is already running — drops the click rather than racing a timing fix.
    if (!beginCrossing(undefined, entryCrossing(theme, entry.save, entry.record))) {
      return
    }
    setEntering({
      save: entry.save,
      record: entry.record,
      characters: entry.characters,
      ready: prepareGameServices()
    })
  }

  const close = (): void => (onClose ? onClose() : closeModal('loadGame'))

  /**
   * Reopens the registrar on a playthrough that never got a timetable. From the Main Menu it's a
   * plain cut; from the Game menu the running game says its last word and is torn down first,
   * under the one curtain, handing on the hour it was left in exactly as leaving to the menu does.
   */
  async function beginResume(playthrough: PlaythroughSummary): Promise<void> {
    const resolved = await resolveEnrollment(playthrough)
    // A refused file has reported itself; a roster it cannot be played with is on its own row.
    if (!resolved || resolved.unloadable) return
    // Fired together: nothing about the registrar waits on ComfyUI.
    void prepareGameServices()

    if (!onClose) {
      const cut = beginCrossing(
        () => {
          stageEnrollment(resolved)
          close()
          setView('classSelect')
        },
        { from: theme }
      )
      if (cut) endCrossing()
      return
    }

    if (!beginCrossing(undefined, menuCrossing(theme))) return
    coverSwap(() => {
      void (async () => {
        await leaveToMenu({ keepCrossing: true })
        setMenuTheme(theme)
        stageEnrollment(resolved)
        setView('classSelect')
        onClose()
        endCrossing()
      })()
    })
  }

  /**
   * The player's own way out, a no-op while covered since the panel is not on screen to dismiss.
   * `inert` stops the pointer and the Tab ring, but not Escape: the shell's Escape rides
   * `window`, which no attribute reaches, so this checks `covered` for itself.
   */
  const dismiss = (): void => {
    if (covered) return
    close()
  }

  /**
   * Leaves a level: the rows wait for the panel to be their size, and the hover is dropped —
   * motion never reports a hover ending on an element that unmounts under the cursor, so a
   * row's ✕ would otherwise still be open when the list comes back.
   */
  const leave = (): void => {
    setSettled(false)
    setHovered(null)
  }

  /** Runs once the service warm-up has settled — hydrate and hand off, under the cover. */
  function onServicesReady(entry: Entering, error: AppError | null): void {
    setEntering(null)
    if (error) {
      // The panel is revealed again and the error read over it, the abandon idiom.
      endCrossing()
      showError(error)
      return
    }

    // Handed over under the cover, without a word about being ready: what the curtain is
    // covering is the game booting, and `enterGame` is what knows when that is done.
    coverSwap(() => {
      if (onClose) {
        // The Game menu's arm: leave the running game and enter this one under the one
        // curtain the click raised. `switchGame` re-reads the save itself — the copy read
        // when the folder was listed may be stale by now — so only the two ids travel.
        // `onClose` lands after `gameStore.loadSave` has already remounted the Game View on
        // its fresh `loads` key: a no-op on the instance it closes.
        void switchGame(entry.save.playthroughId, entry.save.saveId).then(
          onClose,
          (err: unknown) => {
            // The abandon idiom, over a game that is still running rather than the panel.
            endCrossing()
            showError(toAppError(err))
          }
        )
        return
      }

      enterGame(
        entry.save,
        entry.record,
        Object.fromEntries(entry.characters.map((c) => [c.charId, c]))
      )
      close()
      setView('game')
    })
  }

  /**
   * The wait itself, settled by an effect since the crossing's curtain is already the loading
   * screen; the handler rides a ref, being a new function every render.
   */
  const settle = useRef(onServicesReady)
  settle.current = onServicesReady
  useEffect(() => {
    if (!entering) return
    const entry = entering
    let stale = false
    void entry.ready.then(
      () => {
        if (!stale) settle.current(entry, null)
      },
      (err: unknown) => {
        console.error('[load game] the services failed', err)
        if (!stale) settle.current(entry, toAppError(err))
      }
    )
    return () => {
      stale = true
    }
  }, [entering])

  const { host, overlayProps } = useModalShell(dismiss)
  if (!host) return null

  // Whether the body has nothing honest to draw yet. The list already read stands while the
  // folder is re-read, so the modal opens on the playthroughs rather than on an empty list,
  // which would say there are none when what is happening is that nobody has counted yet.
  const waiting = loading && (Boolean(selected) || !loaded)

  return createPortal(
    <>
      <motion.div
        className={`vu-veil${covered ? ' vu-veil--under-curtain' : ''}`}
        data-theme={theme}
        variants={veilIn}
        initial="hidden"
        animate="shown"
        exit="gone"
        {...overlayProps}
        inert={overlayProps.inert || covered}
      >
        <motion.div
          id="load-game"
          className="vu-sheet vu-load vu-paper"
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-label={selected ? selected.label : 'Load Game'}
          variants={panelUnderTab}
          // While the box is not the size of its rows, the body clips rather than scrolls:
          // a scroller squeezed by a tweening panel would otherwise draw its bar over rows
          // that are still invisible (LoadGame.css).
          data-resizing={settled ? undefined : ''}
        >
          <TitleTab>{selected ? selected.label : 'Load Game'}</TitleTab>

          <div className="vu-load-scroll">
            <div className="vu-load-body">
              {/* Nothing is drawn while the folder is read: it is one local read, and a
                  line that announces itself and is gone again says less than a panel
                  holding still. */}
              {waiting ? null : selected ? (
                saves.length === 0 ? (
                  <p className="vu-empty">No saves.</p>
                ) : (
                  <motion.ul
                    className="vu-rows"
                    variants={dealt(0, 0.06)}
                    initial="hidden"
                    animate={settled ? 'shown' : 'hidden'}
                  >
                    {saves.map((entry) => (
                      <SaveRow
                        key={entry.saveId}
                        entry={entry}
                        hovered={hovered === entry.saveId}
                        onHover={(on) => setHovered(on ? entry.saveId : null)}
                        onDelete={() => setDeletingSave(entry)}
                        onClick={() => {
                          // Neither half loads without the other.
                          if (!entry.save || !entry.record) return
                          // Loading over a running game asks first; from the Main Menu the
                          // click loads.
                          if (onClose) setConfirmingLoad(entry)
                          else load(entry)
                        }}
                      />
                    ))}
                  </motion.ul>
                )
              ) : playthroughs.length === 0 ? (
                <p className="vu-empty">No saved games yet.</p>
              ) : (
                <motion.ul
                  className="vu-rows"
                  variants={dealt(0, 0.06)}
                  initial="hidden"
                  animate={settled ? 'shown' : 'hidden'}
                >
                  {playthroughs.map((playthrough) => (
                    <PlaythroughRow
                      key={playthrough.playthroughId}
                      playthrough={playthrough}
                      cast={castOf(playthrough.chars, characters)}
                      // An enrollment has no second level to explain a roster it can no
                      // longer be played with, so the gate a save row gets there is on this one.
                      unloadable={
                        playthrough.unloadable ??
                        (playthrough.enrolling
                          ? unloadableReason(playthrough.chars, characters)
                          : null)
                      }
                      hovered={hovered === playthrough.playthroughId}
                      onHover={(on) => setHovered(on ? playthrough.playthroughId : null)}
                      onDelete={() => setDeletingPlaythrough(playthrough)}
                      onClick={() => {
                        // A folder with no timetable in it yet has a registrar to reopen
                        // rather than saves to list; over a running game that asks first,
                        // exactly as loading a save does.
                        if (playthrough.enrolling) {
                          if (onClose) setConfirmingResume(playthrough)
                          else void beginResume(playthrough)
                          return
                        }
                        leave()
                        void open(playthrough)
                      }}
                    />
                  ))}
                </motion.ul>
              )}
            </div>
            <div className="vu-scroll-fade" />
          </div>

          <div className="vu-foot">
            {selected && (
              <motion.button
                id="load-game-back"
                className="vu-btn vu-btn--quiet"
                type="button"
                {...gestures(false, quietLift, quietPress)}
                onClick={() => {
                  leave()
                  back()
                }}
              >
                Back
              </motion.button>
            )}
            <motion.button
              id="load-game-close"
              className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
              type="button"
              {...gestures(false, lift, press)}
              onClick={dismiss}
            >
              Close
            </motion.button>
          </div>
        </motion.div>
      </motion.div>

      {/* Siblings of the veil, not children: a click inside one does not reach the veil's
          own handler through the React tree. */}
      <AnimatePresence propagate>
        {deletingSave && (
          <ConfirmModal
            key="delete-save"
            id="delete-save"
            theme={theme}
            title={`Delete the save from ${writtenAt(deletingSave.savedAt)}?`}
            message="This save will be permanently deleted."
            confirmText="Delete save"
            onCancel={() => setDeletingSave(null)}
            onConfirm={() => {
              const saveId = deletingSave.saveId
              setDeletingSave(null)
              void removeSave(saveId)
            }}
          />
        )}

        {deletingPlaythrough && (
          <ConfirmModal
            key="delete-playthrough"
            id="delete-playthrough"
            theme={theme}
            title={`Delete ${deletingPlaythrough.label}?`}
            message={
              deletingPlaythrough.enrolling
                ? 'All save will be deleted.'
                : `All ${deletingPlaythrough.saveCount + (deletingPlaythrough.hasAutosave ? 1 : 0)} saves will be permanently deleted.`
            }
            confirmText="Delete playthrough"
            onCancel={() => setDeletingPlaythrough(null)}
            onConfirm={() => {
              const playthroughId = deletingPlaythrough.playthroughId
              setDeletingPlaythrough(null)
              void removePlaythrough(playthroughId)
            }}
          />
        )}

        {confirmingLoad && (
          <ConfirmModal
            key="load-save"
            id="load-save"
            theme={theme}
            title={`Load the save from ${writtenAt(confirmingLoad.savedAt)}?`}
            message={
              hasDecisionPoint()
                ? 'Progress since the last action will be lost.'
                : 'Progress since the last autosave will be lost.'
            }
            confirmText="Load"
            onCancel={() => setConfirmingLoad(null)}
            onConfirm={() => {
              const entry = confirmingLoad
              setConfirmingLoad(null)
              load(entry)
            }}
          />
        )}

        {confirmingResume && (
          <ConfirmModal
            key="resume-enrollment"
            id="resume-enrollment"
            theme={theme}
            title={`Resume ${confirmingResume.label}?`}
            message={
              hasDecisionPoint()
                ? 'Progress since the last action will be lost.'
                : 'Progress since the last autosave will be lost.'
            }
            confirmText="Resume"
            onCancel={() => setConfirmingResume(null)}
            onConfirm={() => {
              const playthrough = confirmingResume
              setConfirmingResume(null)
              void beginResume(playthrough)
            }}
          />
        )}
      </AnimatePresence>
    </>,
    host
  )
}

interface RowProps {
  hovered: boolean
  onHover: (on: boolean) => void
  onClick: () => void
  onDelete: () => void
}

/**
 * One playthrough on the first level, read off its newest readable save. Unreadable saves are
 * marked but the row still opens, so its files can be deleted — except an unloadable
 * **enrollment**, which has nothing to open onto and is marked dead instead of a button.
 */
function PlaythroughRow({
  playthrough,
  cast,
  unloadable,
  hovered,
  onHover,
  onClick,
  onDelete
}: RowProps & {
  playthrough: PlaythroughSummary
  cast: Character[]
  unloadable: string | null
}): JSX.Element {
  const label = `Delete ${playthrough.label} and all of its saves`
  // Reframing a portrait re-cuts the file behind its URL, so the strip reads the version.
  const versions = useCharacterStore((state) => state.spriteVersion)
  const dead = Boolean(playthrough.enrolling && unloadable)

  const body = (
    <>
      <span className="vu-load-sticker">{playthrough.label}</span>

      <span className="vu-load-headline">
        {unloadable
          ? 'Unreadable'
          : playthrough.enrolling
            ? 'Class registration'
            : formatDateBanner(playthrough.date, playthrough.time)}
      </span>

      {/* The faces stand where a list of their names would: recognised, not read. */}
      <span className="vu-load-cast">
        {cast.map((character) => (
          <span className="vu-arch vu-load-arch" key={character.charId}>
            <span className="vu-crop">
              <img
                className="vu-crop-img"
                src={profileUrl(character.charId, versions[character.charId] ?? 0)}
                alt={fullNameOf(character)}
              />
            </span>
          </span>
        ))}
        {/* An archway with nobody in it: every character this playthrough was started
            with has been deleted since. */}
        {cast.length === 0 && <span className="vu-arch vu-load-arch" />}
      </span>

      <span className="vu-load-meta">
        {playthrough.enrolling ? (
          `Registered ${writtenAt(playthrough.savedAt)}`
        ) : (
          <>
            {playthrough.saveCount} of {MAX_SLOT_SAVES} saves
            {playthrough.hasAutosave && ' + autosave'} · Played {writtenAt(playthrough.savedAt)}
            </>
          )}
        </span>
        {unloadable && <span className="vu-load-reason">Cannot load — {unloadable}</span>}
    </>
  )

  return (
    <motion.li
      className="vu-load-row"
      variants={slideIn}
      onHoverStart={() => onHover(true)}
      onHoverEnd={() => onHover(false)}
    >
      {dead ? (
        <div
          id={`playthrough-row-${playthrough.playthroughId}`}
          className="vu-row vu-load-face vu-load-face--cast vu-load-face--dead"
        >
          {body}
        </div>
      ) : (
        <motion.button
          id={`playthrough-row-${playthrough.playthroughId}`}
          className="vu-row vu-load-face vu-load-face--cast"
          type="button"
          {...gestures(false, rowLift, rowPress)}
          onClick={onClick}
        >
          {body}
        </motion.button>
      )}

      <DeleteX hovered={hovered} label={label} onDelete={onDelete} />
    </motion.li>
  )
}

/**
 * One save on the second level: where it sits in the semester, when it was written, and
 * the reason when it cannot be opened — a refused file included.
 */
function SaveRow({
  entry,
  hovered,
  onHover,
  onClick,
  onDelete
}: RowProps & { entry: ResolvedSave }): JSX.Element {
  const { saveId, savedAt, save, unloadable } = entry
  const written = writtenAt(savedAt)
  const dead = Boolean(unloadable)

  const body = (
    <>
      <span className="vu-load-headline">
        {/* An epilogue save is labelled by what the player is doing in it. */}
        {save
          ? save.graduationSeen
            ? GOODBYES_SAVE_LABEL
            : formatDateBanner(save.date, save.time)
          : 'Unreadable save'}
        {saveId === AUTOSAVE_ID && <span className="vu-load-tag">AUTOSAVE</span>}
        {/* A slot-save carries a `scene` too — its banked opening — so only the autosave is
            mid-scene. */}
        {save && saveId === AUTOSAVE_ID && save.scene && (
          <span className="vu-load-midscene">mid-scene</span>
        )}
      </span>
      <span className="vu-load-meta">Saved {written}</span>
      {unloadable && <span className="vu-load-reason">Cannot load — {unloadable}</span>}
    </>
  )

  return (
    <motion.li
      className="vu-load-row"
      variants={slideIn}
      onHoverStart={() => onHover(true)}
      onHoverEnd={() => onHover(false)}
    >
      {/* A save that cannot be opened is not a button, so it is not a tab stop either and is
          handed no gesture — a dead control the browser would still deliver a hover to. */}
      {dead ? (
        <div id={`save-row-${saveId}`} className="vu-row vu-load-face vu-load-face--dead">
          {body}
        </div>
      ) : (
        <motion.button
          id={`save-row-${saveId}`}
          className="vu-row vu-load-face"
          type="button"
          {...gestures(false, rowLift, rowPress)}
          onClick={onClick}
        >
          {body}
        </motion.button>
      )}

      <DeleteX hovered={hovered} label={`Delete the save from ${written}`} onDelete={onDelete} />
    </motion.li>
  )
}

/**
 * The ✕ that removes a row, revealed by the row's own hover. A sibling of the face, never
 * inside it — a button in a button is invalid, and nesting is what would make a click on the ✕
 * also open the row.
 */
function DeleteX({
  hovered,
  label,
  onDelete
}: {
  hovered: boolean
  label: string
  onDelete: () => void
}): JSX.Element {
  return (
    <motion.button
      className="vu-x vu-load-x"
      type="button"
      aria-label={label}
      // Or it flashes at full opacity on mount before animating away.
      initial={false}
      animate={hovered ? peek : tuck}
      whileFocus={peek}
      whileTap={quietPress}
      onClick={onDelete}
    >
      <CloseIcon />
    </motion.button>
  )
}

