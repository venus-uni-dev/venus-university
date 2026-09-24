import { useEffect, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { MANUAL_SAVE_SLOTS } from '@shared/types'
import { manualSlotOf } from '@shared/saveRules'
import { ConfirmModal } from '../components/ConfirmModal'
import {
  SAVE_PAGE_CELLS,
  SavePagesGrid,
  wrapPage,
  type SaveGridCard,
  type SaveGridEmpty
} from '../components/SavePagesGrid'
import { typingIn, useWindowKeydown } from '../components/useWindowKeydown'
import { useModalShell } from '../components/useModalShell'
import { TitleTab } from '../components/TitleTab'
import { useCrossingStore } from '../stores/crossingStore'
import { writeManualSave } from '../stores/gameLoop'
import { useGameStore } from '../stores/gameStore'
import { useSaveStore, type ResolvedSave } from '../stores/saveStore'
import { pageEntriesOf, writtenAt } from './LoadGameModal'
import { gestures, lift, panelUnderTab, press, veilIn } from './motion'

/** Pages of manual slots, ten to a page. */
const SAVE_PAGES = MANUAL_SAVE_SLOTS / SAVE_PAGE_CELLS

/** The page holding the manual save written last, or the first page where there is none. */
function latestPageOf(saves: readonly ResolvedSave[]): number {
  let latest: { slot: number; savedAt: number } | null = null
  for (const entry of saves) {
    const slot = manualSlotOf(entry.saveId)
    if (slot === null) continue
    if (!latest || entry.savedAt > latest.savedAt) latest = { slot, savedAt: entry.savedAt }
  }
  return latest ? Math.floor((latest.slot - 1) / SAVE_PAGE_CELLS) : 0
}

export interface SaveGameModalProps {
  /** Drawn by the screen that opened this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
  onClose: () => void
}

/**
 * The Game menu's Save Game: the running playthrough's manual slots a page at a time. A gap is
 * written on a click, a save already there only once the player has said to overwrite it.
 */
export function SaveGameModal({ theme, onClose }: SaveGameModalProps): JSX.Element | null {
  const listSavesOf = useSaveStore((s) => s.listSavesOf)
  const removeSaveOf = useSaveStore((s) => s.removeSaveOf)
  const covered = useCrossingStore((s) => s.phase !== 'idle')

  // Read once: a playthrough does not change under an open panel.
  const [playthroughId] = useState(() => useGameStore.getState().playthroughId)
  const [saves, setSaves] = useState<ResolvedSave[]>([])
  const [loaded, setLoaded] = useState(false)
  const [page, setPage] = useState(0)
  // A write or a delete is running, and every slot waits for it.
  const [busy, setBusy] = useState(false)
  // The save waiting on the player's yes before it is written over.
  const [overwriting, setOverwriting] = useState<ResolvedSave | null>(null)
  // And the one waiting on it before it is deleted.
  const [deleting, setDeleting] = useState<ResolvedSave | null>(null)

  /** Lists the slots, and opens on the page written to last. */
  useEffect(() => {
    // Outside a playthrough there is nothing to read, and the panel opens on empty slots.
    if (!playthroughId) {
      setLoaded(true)
      return
    }
    let live = true
    void listSavesOf(playthroughId).then((listed) => {
      if (!live) return
      setSaves(listed)
      setPage(latestPageOf(listed))
      setLoaded(true)
    })
    return () => {
      live = false
    }
  }, [listSavesOf, playthroughId])

  /** Runs a write or a delete with every slot held, then lists the slots again. */
  async function settleWith(run: () => Promise<boolean>): Promise<void> {
    if (!playthroughId) return
    setBusy(true)
    if (await run()) setSaves(await listSavesOf(playthroughId))
    setBusy(false)
  }

  /** Whether a question stands over the panel, which then answers no key of its own. */
  const asking = Boolean(overwriting || deleting)

  /** The arrow keys turn the page, as the arrows beside it do. */
  useWindowKeydown((event) => {
    if (!loaded || busy || covered || asking || typingIn(event)) return
    if (event.key === 'ArrowLeft') setPage((current) => wrapPage(current - 1, SAVE_PAGES))
    else if (event.key === 'ArrowRight') setPage((current) => wrapPage(current + 1, SAVE_PAGES))
  })

  const { host, overlayProps } = useModalShell(onClose)
  // Nothing is drawn while the slots are read: it is one local read, and a panel that opens
  // empty and grows a frame later says less than one that opens once.
  if (!host || !loaded) return null

  /** The listed save a card stands for. */
  const entryOf = (card: SaveGridCard): ResolvedSave | undefined =>
    saves.find((candidate) => candidate.saveId === card.saveId)

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
          id="save-game"
          className="vu-sheet vu-sheet--saves vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label="Save Game"
          variants={panelUnderTab}
        >
          <TitleTab>Save Game</TitleTab>

          <SavePagesGrid
            id="save-pages"
            mode="save"
            entries={pageEntriesOf(saves, page + 1)}
            page={page}
            pageCount={SAVE_PAGES}
            onPage={setPage}
            busy={busy}
            onPickEmpty={(empty: SaveGridEmpty) => {
              void settleWith(() => writeManualSave(empty.slot))
            }}
            onPick={(card) => {
              const entry = entryOf(card)
              if (entry) setOverwriting(entry)
            }}
            onDelete={(card) => {
              const entry = entryOf(card)
              if (entry) setDeleting(entry)
            }}
          />

          {/* A panel with nothing to spend has one answer. */}
          <div className="vu-foot">
            <motion.button
              id="save-game-close"
              className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
              type="button"
              {...gestures(false, lift, press)}
              onClick={onClose}
            >
              Close
            </motion.button>
          </div>
        </motion.div>
      </motion.div>

      {/* Siblings of the veil, not children: a click inside one does not reach the veil's
          own handler through the React tree. */}
      <AnimatePresence propagate>
        {overwriting && (
          <ConfirmModal
            key="overwrite-save"
            id="overwrite-save"
            theme={theme}
            title={`Overwrite save ${manualSlotOf(overwriting.saveId) ?? ''}?`}
            message={`The save from ${writtenAt(overwriting.savedAt)} will be replaced.`}
            confirmText="Overwrite"
            onCancel={() => setOverwriting(null)}
            onConfirm={() => {
              const slot = manualSlotOf(overwriting.saveId)
              setOverwriting(null)
              if (slot !== null) void settleWith(() => writeManualSave(slot))
            }}
          />
        )}

        {deleting && (
          <ConfirmModal
            key="delete-save"
            id="delete-save"
            theme={theme}
            title={`Delete the save from ${writtenAt(deleting.savedAt)}?`}
            message="This save will be permanently deleted."
            confirmText="Delete save"
            onCancel={() => setDeleting(null)}
            onConfirm={() => {
              const saveId = deleting.saveId
              setDeleting(null)
              if (playthroughId) void settleWith(() => removeSaveOf(playthroughId, saveId))
            }}
          />
        )}
      </AnimatePresence>
    </>,
    host
  )
}
