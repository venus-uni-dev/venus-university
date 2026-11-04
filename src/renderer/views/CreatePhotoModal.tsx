import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { EMOTIONS } from '@shared/emotions'
import { outfitLabelOf } from '@shared/outfits'
import {
  fitPhotoOptions,
  isReaderRow,
  MAX_PHOTO_CHARACTERS,
  PHOTO_READER_ROW,
  PHOTO_WORDS_MAX,
  type PhotoBackground,
  type PhotoModelChoice,
  type PhotoRow
} from '@shared/photos'
import { THINKING_LEVEL_LABELS, type ImageModelCaps, type ImageSize, type ThinkingLevel } from '@shared/providers'
import {
  allBackgrounds,
  fullNameOf,
  roomBgIdOf,
  type Character,
  type Emotion,
  type WardrobeTarget
} from '@shared/types'
import { isWet } from '@shared/weather'
import { BgSlot } from '../components/BgSlot'
import { DeleteX } from '../components/DeleteX'
import { SelectField } from '../components/SelectField'
import { TextField } from '../components/TextField'
import { TitleTab } from '../components/TitleTab'
import { placeUnder } from '../components/popupPlace'
import { useDismissLayer, useModalShell } from '../components/useModalShell'
import { slotWeather } from '../prompts/weather'
import { useAssetStore } from '../stores/assetStore'
import { profileUrl, roomUrl, useSpriteVersion } from '../stores/characterStore'
import { useGameStore } from '../stores/gameStore'
import { noNsfwImagesOf, useSettingsStore } from '../stores/settingsStore'
import { usePhotoStore, type PhotoDraft } from '../stores/photoStore'
import { BgPicker } from './BgModal'
import { bgThumbUrl, hasRainRender, roomOwnerOf } from './bgAssets'
import {
  gestures,
  lift,
  panelUnderTab,
  press,
  quietLift,
  quietPress,
  toggleLift,
  veilIn
} from './motion'
import { ChevronIcon, HalfMarkIcon, type HalfMarkKind } from './screenIcons'
import '../vu_styles/CreatePhoto.css'

/** The air between the "Add character" pill and the list hung under it. */
const POP_GAP = 6

/** One girl's offered wardrobes: every set she has rendered, minus the nude one where withheld. */
function offeredSets(sets: readonly WardrobeTarget[] | undefined, noNsfw: boolean): WardrobeTarget[] {
  return (sets ?? []).filter((set) => !(noNsfw && set === 'nude'))
}

/** One word, sentence case, for the expression select. */
function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** The sky a photo's background is drawn under. */
type Sky = Pick<PhotoBackground, 'half' | 'rain'>

/** The four skies on offer, in the palette's order. */
const SKIES: ReadonlyArray<Sky & { word: string; mark: HalfMarkKind }> = [
  { half: 'day', rain: false, word: 'Day', mark: 'sun' },
  { half: 'night', rain: false, word: 'Night', mark: 'moon' },
  { half: 'day', rain: true, word: 'Day (rainy)', mark: 'rain' },
  { half: 'night', rain: true, word: 'Night (rainy)', mark: 'rain' }
]

/** Whether the place `bg` can be drawn under `sky`: any place when dry, wet only off its own render. */
function skyOffered(bg: string, sky: Sky): boolean {
  return !sky.rain || hasRainRender(bg, sky.half)
}

/** The model this draft would actually run on: the picked one where it is on offer, else the default. */
function resolveCaps(
  choice: PhotoModelChoice | null,
  options: PhotoDraft['options']
): ImageModelCaps | null {
  if (!choice || choice.models.length === 0) return null
  return choice.models.find((model) => model.id === options.model) ?? choice.models[0]
}

/**
 * The draft fitted to what the models, the wardrobes and the places actually offer: a row whose
 * girl dropped out of contact or lost her last offered wardrobe is gone, as is the reader's where
 * no picture of him is kept, a row's set moves onto an offered one where it is not, the options are fitted to the model that will run, and a
 * background no longer listed, or wet where it has no rain render, is dropped.
 */
function fitDraft(
  draft: PhotoDraft,
  choice: PhotoModelChoice | null,
  wardrobes: Record<string, WardrobeTarget[]>,
  contactIds: readonly string[],
  noNsfw: boolean,
  places: ReadonlySet<string>,
  hasPicture: boolean
): PhotoDraft {
  const rows = draft.rows.flatMap((row): PhotoRow[] => {
    if (isReaderRow(row)) return hasPicture ? [row] : []
    if (!contactIds.includes(row.charId)) return []
    const offered = offeredSets(wardrobes[row.charId], noNsfw)
    if (offered.length === 0) return []
    return [{ ...row, set: offered.includes(row.set) ? row.set : offered[0] }]
  })
  const caps = resolveCaps(choice, draft.options)
  const options = caps ? { ...fitPhotoOptions(draft.options, caps), model: caps.id } : draft.options
  const background =
    draft.background && places.has(draft.background.bg) && skyOffered(draft.background.bg, draft.background)
      ? draft.background
      : undefined
  return { rows, options, prompt: draft.prompt, ...(background ? { background } : {}) }
}

export interface CreatePhotoModalProps {
  theme: 'day' | 'night'
  playthroughId: string
  /** What the form opens on: a new photo's, or the one Edit or Retake asked for. */
  initialDraft: PhotoDraft
  onClose: () => void
}

/**
 * The picture the player builds: where it is set, who is in it, in which outfit and expression,
 * the model and its terms, and his own words. Fixed in size from the moment it opens — the left
 * column reserves the height the background and twelve rows would take, so adding one never
 * resizes the panel.
 */
export function CreatePhotoModal({
  theme,
  playthroughId,
  initialDraft,
  onClose
}: CreatePhotoModalProps): JSX.Element | null {
  const choice = usePhotoStore((s) => s.choice)
  const wardrobes = usePhotoStore((s) => s.wardrobes)
  const loadChoice = usePhotoStore((s) => s.loadChoice)
  const loadWardrobes = usePhotoStore((s) => s.loadWardrobes)
  const createPhoto = usePhotoStore((s) => s.create)
  const chars = useGameStore((s) => s.chars)
  const alumni = useGameStore((s) => s.alumni)
  const charInfo = useGameStore((s) => s.charInfo)
  const characters = useGameStore((s) => s.characters)
  const weather = useGameStore((s) => s.weather)
  const date = useGameStore((s) => s.date)
  const time = useGameStore((s) => s.time)
  const graduationSeen = useGameStore((s) => s.graduationSeen)
  const readerPicture = useGameStore((s) => s.profilePicture)
  const backgrounds = useAssetStore((s) => s.backgrounds)
  const noNsfw = useSettingsStore(noNsfwImagesOf)

  const contactIds = [...chars, ...alumni].filter(
    (charId) => charInfo[charId]?.flags?.gaveContactInfo && !charInfo[charId]?.flags?.blocked
  )

  const [draft, setDraft] = useState<PhotoDraft>(initialDraft)
  const [ready, setReady] = useState(false)
  const [creating, setCreating] = useState(false)
  const [pickingBg, setPickingBg] = useState(false)
  const fittedOnce = useRef(false)

  // Every background the scene may name, which a room id the same as one of them never shadows.
  const listed = useMemo(() => new Set(allBackgrounds(backgrounds)), [backgrounds])
  // Room bg id → owner, off the roster's current names.
  const roomOwners = useMemo(
    () => new Map(Object.values(characters).map((character) => [roomBgIdOf(character), character.charId])),
    [characters]
  )
  const bgOwner = draft.background ? roomOwnerOf(draft.background.bg, roomOwners, listed) : undefined
  const bgVersion = useSpriteVersion(bgOwner)

  // Loaded once, against the contacts as they stood the moment the modal opened.
  useEffect(() => {
    let live = true
    void Promise.all([loadChoice(), loadWardrobes(contactIds)]).then(() => {
      if (live) setReady(true)
    })
    return () => {
      live = false
    }
  }, [])

  // Once, the moment both are in: after this the player's own edits are never overwritten.
  useEffect(() => {
    if (!ready || fittedOnce.current) return
    fittedOnce.current = true
    const places = new Set([...listed, ...roomOwners.keys()])
    setDraft((current) =>
      fitDraft(current, choice, wardrobes, contactIds, noNsfw, places, readerPicture !== null)
    )
  }, [ready, choice, wardrobes])

  const { host, overlayProps } = useModalShell(onClose)

  function updateRow(charId: string, patch: Partial<PhotoRow>): void {
    setDraft((current) => ({
      ...current,
      rows: current.rows.map((row) => (row.charId === charId ? { ...row, ...patch } : row))
    }))
  }

  function removeRow(charId: string): void {
    setDraft((current) => ({
      ...current,
      rows: current.rows.filter((row) => row.charId !== charId)
    }))
  }

  function setBackground(background: PhotoBackground | undefined): void {
    setDraft((current) => {
      const next = { ...current }
      delete next.background
      return background ? { ...next, background } : next
    })
  }

  function addRow(charId: string): void {
    const offered = offeredSets(wardrobes[charId], noNsfw)
    const set: WardrobeTarget = offered[0] ?? 'default'
    setDraft((current) => ({ ...current, rows: [...current.rows, { charId, set, emotion: 'happy' }] }))
  }

  function addReader(): void {
    setDraft((current) => ({
      ...current,
      rows: [...current.rows, { charId: PHOTO_READER_ROW, set: 'default', emotion: 'neutral' }]
    }))
  }

  // The "Add character" list: a floating `.vu-pop`, placed against the panel like the Cast
  // modal's custom-outfits pill.
  const [popupHost, setPopupHost] = useState<HTMLElement | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const addBtn = useRef<HTMLButtonElement | null>(null)
  const pop = useRef<HTMLDivElement | null>(null)
  const [hoveredAdd, setHoveredAdd] = useState(-1)

  useDismissLayer(() => setAddOpen(false), addOpen)

  const offeredContactIds = contactIds.filter(
    (charId) => offeredSets(wardrobes[charId], noNsfw).length > 0
  )
  const remaining = offeredContactIds.filter(
    (charId) => !draft.rows.some((row) => row.charId === charId)
  )
  const readerOffered = readerPicture !== null && !draft.rows.some(isReaderRow)
  const showAdd =
    draft.rows.length < MAX_PHOTO_CHARACTERS && (remaining.length > 0 || readerOffered)
  const showList = addOpen && popupHost !== null
  /** How many rows of the list stand ahead of the contacts. */
  const readerSeats = readerOffered ? 1 : 0

  const reposition = useCallback((): void => {
    const box = addBtn.current
    const layer = pop.current
    const panel = popupHost?.parentElement
    if (!box || !layer || !panel) return
    layer.style.setProperty('min-width', `${Math.round(box.offsetWidth)}px`)
    placeUnder(box, layer, panel, POP_GAP, false)
  }, [popupHost])

  useLayoutEffect(reposition, [reposition, showList, remaining.length, readerOffered])

  useEffect(() => {
    const panel = popupHost?.parentElement
    if (!showList || !panel) return
    panel.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      panel.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [showList, popupHost, reposition])

  useEffect(() => {
    if (!showList) return
    const handleMouseDown = (event: MouseEvent): void => {
      if (event.button !== 0) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (addBtn.current?.contains(target) === true || pop.current?.contains(target) === true) return
      setAddOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [showList])

  if (!host) return null

  const caps = resolveCaps(choice, draft.options)
  const maxReferences = caps?.maxReferences ?? 1
  const noReference = caps !== null && maxReferences === 0
  // The background is a picture of its own, so a model that takes one has no room for it.
  const noBackgroundRoom = !noReference && draft.background !== undefined && maxReferences < 2
  const createDead =
    !ready ||
    draft.rows.length === 0 ||
    !draft.prompt.trim() ||
    noReference ||
    noBackgroundRoom ||
    creating

  const background = draft.background
  const bgSrc = !background
    ? null
    : bgOwner
      ? roomUrl(bgOwner, background.half, bgVersion)
      : bgThumbUrl(background.bg, background.half, background.rain)
  // The sky the picker opens on where nothing is picked: the slot's own.
  const slotSky: Sky = { half: theme, rain: isWet(slotWeather(weather, date, time, graduationSeen)) }

  async function onCreate(): Promise<void> {
    if (createDead) return
    setCreating(true)
    const ok = await createPhoto(playthroughId, draft, maxReferences)
    setCreating(false)
    if (ok) onClose()
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
          id="create-photo"
          className="vu-sheet--wide vu-cp vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label="Create photo"
          variants={panelUnderTab}
        >
          <TitleTab>Create photo</TitleTab>

          <div className="vu-cp-left">
            <BgSlot
              idPrefix="cp"
              src={bgSrc}
              picked={background !== undefined}
              onPick={() => setPickingBg(true)}
              onClear={() => setBackground(undefined)}
            />

            {draft.rows.length === 0 ? (
              <p className="vu-empty">
                {contactIds.length === 0 && readerPicture === null
                  ? 'No contacts yet. Add some friends first.'
                  : 'Add a character to start.'}
              </p>
            ) : (
              <ul className="vu-cp-rows">
                {draft.rows.map((row) => {
                  if (isReaderRow(row)) {
                    return (
                      <ReaderRowCard
                        key={row.charId}
                        picture={readerPicture}
                        onRemove={() => removeRow(row.charId)}
                      />
                    )
                  }
                  const character = characters[row.charId]
                  if (!character) return null
                  return (
                    <PhotoRowCard
                      key={row.charId}
                      row={row}
                      character={character}
                      offered={offeredSets(wardrobes[row.charId], noNsfw)}
                      onChangeSet={(set) => updateRow(row.charId, { set })}
                      onChangeEmotion={(emotion) => updateRow(row.charId, { emotion })}
                      onRemove={() => removeRow(row.charId)}
                    />
                  )
                })}
              </ul>
            )}

            {showAdd && (
              <>
                <motion.button
                  ref={addBtn}
                  id="cp-add-character"
                  className="vu-pill vu-cp-add"
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={showList}
                  {...gestures(false, quietLift, quietPress)}
                  onClick={() => setAddOpen((open) => !open)}
                >
                  Add character
                  <ChevronIcon down />
                </motion.button>
                {showList &&
                  popupHost !== null &&
                  createPortal(
                    <div ref={pop} className="vu-pop">
                      <div className="vu-pop-list" role="listbox" aria-label="Add a character">
                        {readerOffered && (
                          <AddOptionRow
                            src={readerPicture}
                            label="Me"
                            hovered={hoveredAdd === 0}
                            onHover={() => setHoveredAdd(0)}
                            onLeave={() => setHoveredAdd(-1)}
                            onPick={() => {
                              setAddOpen(false)
                              addReader()
                            }}
                          />
                        )}
                        {remaining.map((charId, index) => {
                          const character = characters[charId]
                          if (!character) return null
                          return (
                            <AddOption
                              key={charId}
                              charId={charId}
                              character={character}
                              hovered={index + readerSeats === hoveredAdd}
                              onHover={() => setHoveredAdd(index + readerSeats)}
                              onLeave={() => setHoveredAdd(-1)}
                              onPick={() => {
                                setAddOpen(false)
                                addRow(charId)
                              }}
                            />
                          )
                        })}
                      </div>
                      <div className="vu-scroll-fade" />
                    </div>,
                    popupHost
                  )}
              </>
            )}
          </div>

          <div className="vu-cp-right">
            <div className="vu-cp-fields">
              {choice && choice.models.length > 1 ? (
                <SelectField
                  id="cp-model"
                  label="Model"
                  value={draft.options.model ?? choice.models[0]?.id ?? ''}
                  onChange={(value) => {
                    const newCaps = choice.models.find((model) => model.id === value) ?? choice.models[0]
                    if (!newCaps) return
                    setDraft((current) => ({
                      ...current,
                      options: { ...fitPhotoOptions(current.options, newCaps), model: newCaps.id }
                    }))
                  }}
                  options={choice.models.map((model) => ({ value: model.id, label: model.label }))}
                />
              ) : (
                caps && (
                  <div className="vu-field">
                    <span className="vu-field-label">Model</span>
                    <span className="vu-cp-reading">{caps.id}</span>
                  </div>
                )
              )}

              <div className="vu-cp-options">
                {caps && caps.sizes.length > 0 && (
                  <SelectField
                    id="cp-size"
                    label="Resolution"
                    value={draft.options.imageSize ?? caps.sizes[0]}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        options: { ...current.options, imageSize: value as ImageSize }
                      }))
                    }
                    options={caps.sizes.map((size) => ({ value: size, label: size }))}
                  />
                )}
  
                {caps && caps.aspectRatios.length > 0 && (
                  <SelectField
                    id="cp-ratio"
                    label="Aspect ratio"
                    value={draft.options.aspectRatio}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, options: { ...current.options, aspectRatio: value } }))
                    }
                    options={caps.aspectRatios.map((ratio) => ({ value: ratio, label: ratio }))}
                  />
                )}
  
                {caps && caps.thinkingLevels.length > 0 && (
                  <SelectField
                    id="cp-thinking"
                    label="Thinking"
                    value={draft.options.thinkingLevel ?? caps.thinkingLevels[0]}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        options: { ...current.options, thinkingLevel: value as ThinkingLevel }
                      }))
                    }
                    options={caps.thinkingLevels.map((level) => ({ value: level, label: THINKING_LEVEL_LABELS[level] }))}
                  />
                )}
  
                {caps && caps.qualities.length > 0 && (
                  <SelectField
                    id="cp-quality"
                    label="Quality"
                    value={draft.options.quality ?? caps.qualities[0]}
                    onChange={(value) =>
                      setDraft((current) => ({ ...current, options: { ...current.options, quality: value } }))
                    }
                    options={caps.qualities.map((quality) => ({ value: quality, label: quality }))}
                  />
                )}
              </div>

              <div
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.stopPropagation()
                }}
              >
                <TextField
                  id="cp-prompt"
                  label="Prompt"
                  value={draft.prompt}
                  onChange={(value) => setDraft((current) => ({ ...current, prompt: value }))}
                  multiline
                  rows={9}
                  maxLength={PHOTO_WORDS_MAX}
                />
              </div>

              <p className="vu-check-note">
                Please keep an eye on your spending as you create since image gen can be expensive on
                some models.
              </p>
            </div>

            <div className="vu-cp-foot-stack">
              <span className="vu-form-status">
                {noReference && (
                  <>
                    <span className="vu-form-dot vu-form-dot--warn" />
                    This model can&apos;t take a reference picture, so it can&apos;t draw your
                    characters.
                  </>
                )}
                {noBackgroundRoom && (
                  <>
                    <span className="vu-form-dot vu-form-dot--warn" />
                    This model takes only one reference picture, so it can&apos;t take a background
                    as well.
                  </>
                )}
              </span>
              <div className="vu-foot">
                <motion.button
                  id="cp-cancel"
                  className="vu-btn vu-btn--quiet"
                  type="button"
                  {...gestures(false, quietLift, quietPress)}
                  onClick={onClose}
                >
                  Cancel
                </motion.button>
                <motion.button
                  id="cp-create"
                  className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
                  type="button"
                  disabled={createDead}
                  {...gestures(createDead, lift, press)}
                  onClick={() => void onCreate()}
                >
                  {creating ? 'Creating…' : 'Create'}
                </motion.button>
              </div>
            </div>
          </div>

          <div className="vu-popups" ref={setPopupHost} />
        </motion.div>
      </motion.div>

      {/* A sibling of the veil, not a child: it leaves when this panel does. */}
      <AnimatePresence propagate>
        {pickingBg && (
          <PhotoBgPicker
            key="photo-bg"
            theme={theme}
            background={background}
            slotSky={slotSky}
            onChange={setBackground}
            onClose={() => setPickingBg(false)}
          />
        )}
      </AnimatePresence>
    </>,
    host
  )
}

/**
 * The background picker as a photo opens it: the scene's shelves under a palette of the four
 * skies, a place without the render a wet sky asks for dead, and a press on the picked place
 * taking it away again. Every press is already the answer.
 */
function PhotoBgPicker({
  theme,
  background,
  slotSky,
  onChange,
  onClose
}: {
  theme: 'day' | 'night'
  background: PhotoBackground | undefined
  /** The sky it opens on where nothing is picked. */
  slotSky: Sky
  onChange: (background: PhotoBackground | undefined) => void
  onClose: () => void
}): JSX.Element {
  const [sky, setSky] = useState<Sky>(() =>
    background ? { half: background.half, rain: background.rain } : slotSky
  )

  // A picked place goes with the sky where it has the render, and is let go where it has not.
  function changeSky(next: Sky): void {
    setSky(next)
    if (!background) return
    onChange(skyOffered(background.bg, next) ? { bg: background.bg, ...next } : undefined)
  }

  return (
    <BgPicker
      theme={theme}
      half={sky.half}
      wet={sky.rain}
      title="Background"
      label="Where the photo is set"
      picked={background?.bg ?? null}
      onPick={(id) => onChange(id === background?.bg ? undefined : { bg: id, ...sky })}
      dead={(id) => !skyOffered(id, sky)}
      header={
        <div className="vu-field vu-cp-sky">
          <span className="vu-field-label" id="cp-sky-label">
            Time and weather
          </span>
          <div className="vu-palette" role="group" aria-labelledby="cp-sky-label">
            {SKIES.map((entry) => {
              const on = entry.half === sky.half && entry.rain === sky.rain
              const id = `${entry.half}${entry.rain ? '-rain' : ''}`
              return (
                <motion.button
                  key={id}
                  id={`cp-sky-${id}`}
                  className={`vu-palette-btn${on ? ' vu-palette-btn--on' : ''}`}
                  type="button"
                  aria-pressed={on}
                  {...gestures(false, toggleLift, quietPress)}
                  onClick={() => changeSky({ half: entry.half, rain: entry.rain })}
                >
                  <HalfMarkIcon kind={entry.mark} strokeWidth={2.5} still />
                  {entry.word}
                </motion.button>
              )
            })}
          </div>
        </div>
      }
      onClose={onClose}
    />
  )
}

/** One girl's row: her face, her name, and the two selects that pick what she wears and shows. */
function PhotoRowCard({
  row,
  character,
  offered,
  onChangeSet,
  onChangeEmotion,
  onRemove
}: {
  row: PhotoRow
  character: Character
  offered: readonly WardrobeTarget[]
  onChangeSet: (set: WardrobeTarget) => void
  onChangeEmotion: (emotion: Emotion) => void
  onRemove: () => void
}): JSX.Element {
  const version = useSpriteVersion(row.charId)
  const [hovered, setHovered] = useState(false)
  const name = fullNameOf(character)

  return (
    <motion.li
      className="vu-cp-row-wrap"
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
    >
      <div className="vu-cp-row">
        <span className="vu-arch vu-cp-face">
          <span className="vu-crop">
            <img className="vu-crop-img" src={profileUrl(row.charId, version)} alt="" />
          </span>
        </span>
        <span className="vu-cp-name">{name}</span>
        <div className="vu-field vu-cp-select">
          <select
            className="vu-input vu-select"
            aria-label={`${name}'s outfit`}
            value={row.set}
            onChange={(event) => onChangeSet(event.target.value as WardrobeTarget)}
          >
            {offered.map((set) => (
              <option key={set} value={set}>
                {set === 'default' ? 'Main outfit' : outfitLabelOf(character, set)}
              </option>
            ))}
          </select>
        </div>
        <div className="vu-field vu-cp-select">
          <select
            className="vu-input vu-select"
            aria-label={`${name}'s expression`}
            value={row.emotion}
            onChange={(event) => onChangeEmotion(event.target.value as Emotion)}
          >
            {EMOTIONS.map((emotion) => (
              <option key={emotion} value={emotion}>
                {capitalize(emotion)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <DeleteX
        className="vu-x vu-cp-row-x"
        hovered={hovered}
        label={`Remove ${name}`}
        onDelete={onRemove}
      />
    </motion.li>
  )
}

/** The reader's own row: his picture and the one word, there being nothing of his to pick. */
function ReaderRowCard({
  picture,
  onRemove
}: {
  picture: string | null
  onRemove: () => void
}): JSX.Element {
  const [hovered, setHovered] = useState(false)
  return (
    <motion.li
      className="vu-cp-row-wrap"
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
    >
      <div className="vu-cp-row">
        <span className="vu-arch vu-cp-face">
          <span className="vu-crop">
            {picture && <img className="vu-crop-img" src={picture} alt="" />}
          </span>
        </span>
        <span className="vu-cp-name">Me</span>
      </div>
      <DeleteX
        className="vu-x vu-cp-row-x"
        hovered={hovered}
        label="Remove yourself"
        onDelete={onRemove}
      />
    </motion.li>
  )
}

/** One row of the "Add character" list: a face beside a name. */
function AddOptionRow({
  src,
  label,
  hovered,
  onHover,
  onLeave,
  onPick
}: {
  src: string | null
  label: string
  hovered: boolean
  onHover: () => void
  onLeave: () => void
  onPick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={`vu-pop-option vu-cp-pop-option${hovered ? ' vu-pop-option--on' : ''}`}
      role="option"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      onClick={onPick}
    >
      <span className="vu-arch vu-cp-pop-face">
        <span className="vu-crop">
          {src && <img className="vu-crop-img" src={src} alt="" />}
        </span>
      </span>
      {label}
    </button>
  )
}

/** One girl in the "Add character" list. */
function AddOption({
  charId,
  character,
  hovered,
  onHover,
  onLeave,
  onPick
}: {
  charId: string
  character: Character
  hovered: boolean
  onHover: () => void
  onLeave: () => void
  onPick: () => void
}): JSX.Element {
  const version = useSpriteVersion(charId)
  return (
    <AddOptionRow
      src={profileUrl(charId, version)}
      label={fullNameOf(character)}
      hovered={hovered}
      onHover={onHover}
      onLeave={onLeave}
      onPick={onPick}
    />
  )
}
