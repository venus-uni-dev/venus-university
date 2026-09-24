import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, type AnimationPlaybackControls } from 'motion/react'
import { toAppError } from '@shared/errors'
import { classifySaveId, manualSlotOf } from '@shared/saveRules'
import {
  MANUAL_SAVE_SLOTS,
  MAX_SLOT_SAVES,
  fullNameOf,
  type Character,
  type GameSave,
  type PlaythroughRecord,
  type PlaythroughSummary
} from '@shared/types'
import { ConfirmModal } from '../components/ConfirmModal'
import { DeleteX } from '../components/DeleteX'
import {
  SAVE_PAGE_CELLS,
  SavePagesGrid,
  wrapPage,
  type SaveGridCard,
  type SaveGridEntry
} from '../components/SavePagesGrid'
import { typingIn, useWindowKeydown } from '../components/useWindowKeydown'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { formatDateBanner } from '../prompts/gameDate'
import { GOODBYES_SAVE_LABEL } from '../prompts/graduation'
import { profileUrl, useCharacterStore } from '../stores/characterStore'
import { beginCrossing, coverSwap, endCrossing, useCrossingStore } from '../stores/crossingStore'
import { enterGame, hasDecisionPoint, leaveToMenu, switchGame } from '../stores/gameLoop'
import { stageEnrollment } from '../stores/newGame'
import {
  castOf,
  unloadableReason,
  useSaveStore,
  type ResolvedSave
} from '../stores/saveStore'
import { entryCrossing, menuCrossing } from '../stores/slotCrossing'
import { useUiStore } from '../stores/uiStore'
import { saveThumbUrl } from './bgAssets'
import {
  dealt,
  gestures,
  lift,
  panelUnderTab,
  press,
  quietLift,
  quietPress,
  rowLift,
  rowPress,
  slideIn,
  tweenSize,
  veilIn
} from './motion'
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

/** A save on its way in, held until the crossing has drawn its cover. */
interface Entering {
  save: GameSave
  record: PlaythroughRecord
  characters: Character[]
}

/** Pages of the second level: the autosaves, then the manual slots ten to a page. */
const LOAD_PAGES = 1 + MANUAL_SAVE_SLOTS / SAVE_PAGE_CELLS

/** When a file was written, in the machine's own locale. */
export function writtenAt(savedAt: number): string {
  return new Date(savedAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

/** The same moment as a card's one line carries it: the day and the time, without the year. */
function writtenAtShort(savedAt: number): string {
  return new Date(savedAt).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

/** A count and the noun it counts, singular for one. */
function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** A save as its card draws it: where it sits in the semester, when it was written, its gate. */
function cardOf(entry: ResolvedSave, sticker: string): SaveGridCard {
  const { saveId, savedAt, summary, unloadable } = entry
  return {
    kind: 'card',
    saveId,
    sticker,
    // An epilogue save is labelled by what the player is doing in it.
    headline: summary
      ? summary.graduationSeen
        ? GOODBYES_SAVE_LABEL
        : formatDateBanner(summary.date, summary.time)
      : 'Unreadable save',
    meta: `Saved ${writtenAtShort(savedAt)}`,
    reason: unloadable ? `Cannot load — ${unloadable}` : null,
    thumbSrc: summary ? saveThumbUrl(summary) : null,
    dead: Boolean(unloadable),
    deletable: true
  }
}

/**
 * One page of a playthrough's saves, ten cells in slot order, laid down the columns. Page 0 is
 * the scene autosave and then the newest boundary autosaves; every page after it is ten manual
 * slots in order. A slot with nothing in it is a gap wearing the same sticker.
 */
export function pageEntriesOf(saves: readonly ResolvedSave[], page: number): SaveGridEntry[] {
  if (page === 0) {
    const autosave = saves.find((entry) => classifySaveId(entry.saveId) === 'autosave')
    const boundary = saves.filter((entry) => classifySaveId(entry.saveId) === 'boundary')
    const cells: SaveGridEntry[] = [
      autosave
        ? cardOf(autosave, 'SCENE AUTOSAVE')
        : { kind: 'empty', slot: 0, sticker: 'SCENE AUTOSAVE' }
    ]
    for (let i = 0; i < MAX_SLOT_SAVES; i++) {
      const sticker = `AUTOSAVE ${i + 1}`
      const entry = boundary[i]
      cells.push(entry ? cardOf(entry, sticker) : { kind: 'empty', slot: i + 1, sticker })
    }
    return cells
  }

  const first = (page - 1) * SAVE_PAGE_CELLS + 1
  return Array.from({ length: SAVE_PAGE_CELLS }, (_, i): SaveGridEntry => {
    const slot = first + i
    const sticker = String(slot)
    const entry = saves.find((candidate) => manualSlotOf(candidate.saveId) === slot)
    return entry ? cardOf(entry, sticker) : { kind: 'empty', slot, sticker }
  })
}

/**
 * Load Game, in two levels on one panel: every playthrough in creation order, then the saves
 * inside the one picked, a page at a time with its own load gate per save.
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
  const readSave = useSaveStore((s) => s.readSave)
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
  // Which page of the open playthrough's saves is on screen.
  const [page, setPage] = useState(0)

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

  // Whether the body has nothing honest to draw yet. The list already read stands while the
  // folder is re-read, so the modal opens on the playthroughs rather than on an empty list,
  // which would say there are none when what is happening is that nobody has counted yet.
  const waiting = loading && (Boolean(selected) || !loaded)

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

  /**
   * The save read whole, the cover up and the save handed off under it: the click's body, once
   * the player has said yes. A refused read has reported itself.
   */
  async function load(playthroughId: string, entry: ResolvedSave): Promise<void> {
    const whole = await readSave(playthroughId, entry.saveId)
    if (!whole || whole.unloadable) return
    // The cover goes up on the click and the game is hydrated under it, wearing the hour the
    // save is set in rather than the panel's. A refused cover — only reachable from the Game
    // menu, when a game is already running — drops the click rather than racing a timing fix.
    if (!beginCrossing(undefined, entryCrossing(theme, whole.save, whole.record))) {
      return
    }
    setEntering({
      save: whole.save,
      record: whole.record,
      characters: whole.characters
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
   * Leaves a level: the rows wait for the panel to be their size, the hover is dropped —
   * motion never reports a hover ending on an element that unmounts under the cursor, so a
   * row's ✕ would otherwise still be open when the list comes back — and the saves open again
   * on their first page.
   */
  const leave = (): void => {
    setSettled(false)
    setHovered(null)
    setPage(0)
  }

  /** Whether a question stands over the panel, which then answers no key of its own. */
  const asking = Boolean(deletingSave || deletingPlaythrough || confirmingLoad || confirmingResume)

  /** The arrow keys turn the page of saves, as the arrows beside it do. */
  useWindowKeydown((event) => {
    if (!selected || waiting || covered || asking || typingIn(event)) return
    if (event.key === 'ArrowLeft') setPage((current) => wrapPage(current - 1, LOAD_PAGES))
    else if (event.key === 'ArrowRight') setPage((current) => wrapPage(current + 1, LOAD_PAGES))
  })

  /** Hydrates the held save and hands it to whoever runs it, under the cover. */
  function handOff(entry: Entering): void {
    setEntering(null)
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
   * The hand-off, run from an effect so it lands after the crossing has rendered its cover;
   * the handler rides a ref, being a new function every render.
   */
  const settle = useRef(handOff)
  settle.current = handOff
  useEffect(() => {
    if (!entering) return
    settle.current(entering)
  }, [entering])

  const { host, overlayProps } = useModalShell(dismiss)
  if (!host) return null

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
          className="vu-sheet vu-sheet--saves vu-load vu-paper"
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

          {selected && !waiting ? (
            // The page of saves never scrolls: every page is the same size, gaps included.
            <div className="vu-load-pages">
              <SavePagesGrid
                id="save-pages"
                mode="load"
                entries={pageEntriesOf(saves, page)}
                page={page}
                pageCount={LOAD_PAGES}
                onPage={setPage}
                held={!settled}
                onPick={(card) => {
                  const entry = saves.find((candidate) => candidate.saveId === card.saveId)
                  // Neither half loads without the other.
                  if (!entry?.summary || !entry.record) return
                  // Loading over a running game asks first; from the Main Menu the click loads.
                  if (onClose) setConfirmingLoad(entry)
                  else void load(selected.playthroughId, entry)
                }}
                onDelete={(card) => {
                  const entry = saves.find((candidate) => candidate.saveId === card.saveId)
                  if (entry) setDeletingSave(entry)
                }}
              />
            </div>
          ) : (
            <div className="vu-load-scroll">
              <div className="vu-load-body">
                {/* Nothing is drawn while the folder is read: it is one local read, and a
                    line that announces itself and is gone again says less than a panel
                    holding still. */}
                {waiting ? null : playthroughs.length === 0 ? (
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
          )}

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
                : `All ${deletingPlaythrough.saveCount + deletingPlaythrough.manualCount + (deletingPlaythrough.hasAutosave ? 1 : 0)} saves will be permanently deleted.`
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
              if (selected) void load(selected.playthroughId, entry)
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
  // The scene autosave counts among the autosaves where there is one.
  const autosaves = playthrough.saveCount + (playthrough.hasAutosave ? 1 : 0)

  const body = (
    <>
      <span className="vu-sticker vu-load-sticker">{playthrough.label}</span>

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
        {playthrough.enrolling
          ? `Registered ${writtenAt(playthrough.savedAt)}`
          : `${countOf(playthrough.manualCount, 'save')} · ${countOf(autosaves, 'autosave')} · Played ${writtenAt(playthrough.savedAt)}`}
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

      <DeleteX className="vu-x vu-load-x" hovered={hovered} label={label} onDelete={onDelete} />
    </motion.li>
  )
}
