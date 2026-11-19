/**
 * The Scene Creator: up to three girls and where each stands with the reader and with each other,
 * the reader himself, the day, half, sky and place, and the opening action — then one scene
 * played from it on the real stage, outside any playthrough. Saved scenes are replayed from here.
 */
import { useEffect, useMemo, useState, type JSX } from 'react'
import { AnimatePresence, motion } from 'motion/react'

import {
  asReaderPronouns,
  genderOf,
  READER_PRONOUN_LABELS,
  READER_PRONOUNS
} from '@shared/gender'
import { isCustomOutfitSlot, outfitLabelOf } from '@shared/outfits'
import { STAT_KEYS, STAT_LABELS, MAX_TIER, MIN_TIER, tierNameOf, type StatTier } from '@shared/playerStats'
import { DISPOSITION_LABELS, type Disposition } from '@shared/relationship'
import {
  effectiveDisposition,
  flagsOfEntry,
  normalizeMilestones,
  SCENE_DISPOSITIONS,
  SCENE_FIRST_DATE,
  SCENE_LAST_DATE,
  setupStartable,
  type SavedScene,
  type SceneCastEntry,
  type SceneSetup
} from '@shared/sceneCreator'
import {
  allBackgrounds,
  DEFAULT_PLAYER_FIRST_NAMES,
  DEFAULT_PLAYER_LAST_NAME,
  fullNameOf,
  roomBgIdOf,
  type Character,
  type OutfitLock,
  type TimeSlot
} from '@shared/types'
import { WEATHER_KINDS, type Weather } from '@shared/weather'
import { BgSlot } from '../components/BgSlot'
import { DeleteX } from '../components/DeleteX'
import { SelectField } from '../components/SelectField'
import { TextField } from '../components/TextField'
import { formatGameDate, formatWeekday, slotHalf } from '../prompts/gameDate'
import { useAssetStore } from '../stores/assetStore'
import {
  profileUrl,
  readyOutfitSets,
  roomUrl,
  useCharacterStore,
  useSpriteVersion
} from '../stores/characterStore'
import { beginCrossing, coverSwap } from '../stores/crossingStore'
import { enterCreatedScene } from '../stores/gameLoop'
import { noNsfwImagesOf, useSettingsStore } from '../stores/settingsStore'
import {
  setupOfDraft,
  useSceneCreatorStore,
  type SceneDraft
} from '../stores/sceneCreatorStore'
import { useUiStore } from '../stores/uiStore'
import { BgPicker } from './BgModal'
import { bgThumbUrl } from './bgAssets'
import { heldScreenTheme, type ScreenTheme } from './clockTheme'
import { DatePickerModal } from './DatePickerModal'
import { LoadCharacterModal } from './LoadCharacterModal'
import { LoadSceneModal } from './LoadSceneModal'
import {
  decorIn,
  fadeIn,
  gestures,
  lift,
  press,
  quietLift,
  quietPress,
  rowLift,
  rowPress
} from './motion'
import { SceneMilestonesModal } from './SceneMilestonesModal'
import { SceneNotesModal } from './SceneNotesModal'
import { SceneRelationshipsModal } from './SceneRelationshipsModal'
import { PlusIcon } from './screenIcons'
import '../vu_styles/SceneCreator.css'

/** The panel in front of the screen, if any, and the row it was opened from. */
type Panel =
  | { kind: 'pick'; row: number }
  | { kind: 'milestones'; row: number }
  | { kind: 'relations'; row: number }
  | { kind: 'notes'; row: number }
  | { kind: 'date' }
  | { kind: 'bg' }
  | { kind: 'load' }

const DISPOSITION_OPTIONS = SCENE_DISPOSITIONS.map((disposition) => ({
  value: disposition,
  label: DISPOSITION_LABELS[disposition]
}))

const TIME_OPTIONS = [
  { value: '0', label: 'Day' },
  { value: '1', label: 'Night' }
]

/** Each sky as the dropdown names it. */
const WEATHER_LABELS: Record<Weather, string> = {
  clear: 'Clear',
  rain: 'Rain',
  storm: 'Thunderstorm'
}

const WEATHER_OPTIONS = WEATHER_KINDS.map((weather) => ({
  value: weather,
  label: WEATHER_LABELS[weather]
}))

const TIER_OPTIONS = Array.from({ length: MAX_TIER - MIN_TIER + 1 }, (_, i) => {
  const tier = (MIN_TIER + i) as StatTier
  return { value: String(tier), label: tierNameOf(tier) }
})

/** The wardrobes she can open the scene in: her main one, and every set whole on disk not withheld. */
function offeredOutfitsOf(
  status: Parameters<typeof readyOutfitSets>[0],
  noNsfwImages: boolean
): OutfitLock[] {
  return ['default', ...readyOutfitSets(status).filter((set) => !(noNsfwImages && set === 'nude'))]
}

/** A wardrobe as the outfit dropdown names it: the stock sets capitalised, her own as written. */
function outfitOptionLabel(character: Character, outfit: OutfitLock): string {
  if (outfit === 'default') return 'Default'
  const label = outfitLabelOf(character, outfit)
  return isCustomOutfitSlot(outfit) ? label : label.charAt(0).toUpperCase() + label.slice(1)
}

/** The Scene Creator screen. */
export function SceneCreatorView(): JSX.Element {
  const [theme] = useState(heldScreenTheme)
  const draft = useSceneCreatorStore((s) => s.draft)
  const saved = useSceneCreatorStore((s) => s.saved)
  const characters = useCharacterStore((s) => s.characters)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    void useSceneCreatorStore.getState().start()
    void useSceneCreatorStore.getState().loadSaved()
    void useCharacterStore.getState().load()
  }, [])

  // A girl deleted since she was picked leaves her row, once the roster has been read again.
  const loading = useCharacterStore((s) => s.loading)
  useEffect(() => {
    if (loading || Object.keys(characters).length === 0 || !draft) return
    draft.rows.forEach((entry, row) => {
      if (entry && !characters[entry.charId]) useSceneCreatorStore.getState().setRow(row, null)
    })
  }, [loading, characters, draft])

  const setView = useUiStore((s) => s.setView)

  /** Covers the screen and enters the scene the setup plays, or the saved scene `replay`. */
  function enter(picked: SceneSetup, replay?: SavedScene): void {
    const { characters: onDisk, outfits } = useCharacterStore.getState()
    const noNsfwImages = noNsfwImagesOf(useSettingsStore.getState())
    // A wardrobe since withheld or deleted opens as her main outfit, as her row shows it.
    const setup: SceneSetup = {
      ...picked,
      cast: picked.cast.map((entry) =>
        offeredOutfitsOf(outfits[entry.charId], noNsfwImages).includes(entry.outfit)
          ? entry
          : { ...entry, outfit: 'default' }
      )
    }
    const cast: Record<string, Character> = {}
    for (const entry of setup.cast) {
      const character = onDisk[entry.charId]
      if (character) cast[entry.charId] = character
    }
    setStarting(true)
    beginCrossing(undefined, { from: theme, to: slotHalf(setup.time), wait: !replay })
    coverSwap(() => {
      enterCreatedScene(setup, cast, replay)
      setView('game')
    })
  }

  /** Reads one saved scene whole and replays it, if every girl in it is still on disk. */
  async function openSaved(id: string): Promise<void> {
    const scene = await useSceneCreatorStore.getState().readSaved(id)
    if (!scene) return
    const onDisk = useCharacterStore.getState().characters
    if (!scene.setup.cast.every((entry) => onDisk[entry.charId])) return
    setPanel(null)
    enter(scene.setup, scene)
  }

  if (!draft) return <div className="vu-scene-creator" data-theme={theme} />

  const setup = setupOfDraft(draft)
  const startDead = starting || !setupStartable(setup)
  const loadDead = starting || !saved || saved.length === 0

  return (
    <div className="vu-scene-creator" data-theme={theme} inert={starting || undefined}>
      <motion.div className="vu-scene-creator-decor" variants={decorIn} initial="hidden" animate="shown" />

      <motion.header
        className="vu-scene-creator-header"
        variants={fadeIn(0.1)}
        initial="hidden"
        animate="shown"
      >
        <div className="vu-title">
          <h1 className="vu-title-text">Scene Creator</h1>
        </div>
      </motion.header>

      <motion.div
        className="vu-scene-creator-body"
        variants={fadeIn(0.2)}
        initial="hidden"
        animate="shown"
      >
        <div className="vu-scene-creator-main">
          <ul className="vu-scene-cast">
            {draft.rows.map((entry, row) =>
              entry && characters[entry.charId] ? (
                <CastRow
                  key={`${row}-${entry.charId}`}
                  row={row}
                  entry={entry}
                  character={characters[entry.charId]}
                  others={setup.cast.length}
                  onPanel={setPanel}
                />
              ) : (
                <EmptyRow key={row} row={row} onPick={() => setPanel({ kind: 'pick', row })} />
              )
            )}
          </ul>

          <SceneRow draft={draft} onPanel={setPanel} />

          <TextField
            id="scene-prompt"
            label="Prompt"
            value={draft.prompt}
            onChange={(value) => useSceneCreatorStore.getState().setPrompt(value)}
            multiline
          />
        </div>

        <ReaderColumn draft={draft} />
      </motion.div>

      <motion.footer
        className="vu-scene-creator-foot"
        variants={fadeIn(0.3)}
        initial="hidden"
        animate="shown"
      >
        <motion.button
          id="scene-creator-back"
          className="vu-btn vu-btn--outline vu-paper"
          type="button"
          {...gestures(starting, lift, press)}
          disabled={starting}
          onClick={() => setView('mainMenu')}
        >
          Back
        </motion.button>
        <motion.button
          id="scene-creator-load"
          className="vu-btn vu-btn--outline vu-paper"
          type="button"
          {...gestures(loadDead, lift, press)}
          disabled={loadDead}
          onClick={() => setPanel({ kind: 'load' })}
        >
          Load scene
        </motion.button>
        <motion.button
          id="scene-creator-start"
          className="vu-btn vu-btn--primary vu-paper"
          type="button"
          {...gestures(startDead, lift, press)}
          disabled={startDead}
          onClick={() => enter(setup)}
        >
          Start scene
        </motion.button>
      </motion.footer>

      <AnimatePresence>
        {panel && (
          <PanelFor
            key={panel.kind}
            panel={panel}
            theme={theme}
            draft={draft}
            onOpenSaved={(id) => void openSaved(id)}
            onClose={() => setPanel(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/** An empty row: the gap it is, naming what it holds and opening the picker. */
function EmptyRow({ row, onPick }: { row: number; onPick: () => void }): JSX.Element {
  return (
    <li className="vu-scene-cast-item">
      <motion.button
        id={`scene-cast-add-${row}`}
        className="vu-scene-cast-gap"
        type="button"
        {...gestures(false, rowLift, rowPress)}
        onClick={onPick}
      >
        <span className="vu-scene-cast-gap-word">Character {row + 1}</span>
        <span className="vu-circle vu-scene-cast-plus" aria-hidden="true">
          <PlusIcon size={22} />
        </span>
      </motion.button>
    </li>
  )
}

/** A filled row: her face and name, what she wears and how she feels, and the three panels. */
function CastRow({
  row,
  entry,
  character,
  others,
  onPanel
}: {
  row: number
  entry: SceneCastEntry
  character: Character
  /** How many girls the scene holds, her included. */
  others: number
  onPanel: (panel: Panel) => void
}): JSX.Element {
  const version = useSpriteVersion(entry.charId)
  const status = useCharacterStore((s) => s.outfits[entry.charId])
  const noNsfwImages = useSettingsStore(noNsfwImagesOf)
  const [hover, setHover] = useState(false)
  const store = useSceneCreatorStore.getState()
  const name = fullNameOf(character)

  const outfits = useMemo(() => offeredOutfitsOf(status, noNsfwImages), [status, noNsfwImages])
  // A wardrobe since withheld or deleted opens as her main outfit.
  const outfit = outfits.includes(entry.outfit) ? entry.outfit : 'default'
  const disposition = effectiveDisposition(entry)

  return (
    <li
      className="vu-scene-cast-item"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="vu-scene-cast-row">
        <span className="vu-arch vu-scene-cast-face">
          <span className="vu-crop">
            <img className="vu-crop-img" src={profileUrl(entry.charId, version)} alt="" />
          </span>
        </span>
        <span className="vu-scene-cast-name">
          <span className="vu-scene-cast-first">{character.firstName}</span>
          <span className="vu-scene-cast-last">{character.lastName}</span>
        </span>
        <div className="vu-scene-cast-select">
          <SelectField
            id={`scene-outfit-${row}`}
            label="Outfit"
            value={outfit}
            options={outfits.map((set) => ({ value: set, label: outfitOptionLabel(character, set) }))}
            onChange={(value) => store.patchRow(row, { outfit: value as OutfitLock })}
          />
        </div>
        <div className="vu-scene-cast-select">
          <SelectField
            id={`scene-disposition-${row}`}
            label="Disposition"
            value={disposition}
            options={DISPOSITION_OPTIONS}
            disabled={!entry.milestones.met}
            onChange={(value) => {
              const next = value as Disposition
              store.patchRow(row, {
                disposition: next,
                milestones: normalizeMilestones(entry.milestones, next, character)
              })
            }}
          />
        </div>
        <div className="vu-scene-cast-actions">
          <motion.button
            id={`scene-milestones-${row}`}
            className="vu-pill"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={() => onPanel({ kind: 'milestones', row })}
          >
            Set milestones
          </motion.button>
          {others > 1 && (
            <motion.button
              id={`scene-relations-${row}`}
              className="vu-pill"
              type="button"
              {...gestures(false, quietLift, quietPress)}
              onClick={() => onPanel({ kind: 'relations', row })}
            >
              Set relationships
            </motion.button>
          )}
          <motion.button
            id={`scene-notes-${row}`}
            className="vu-pill"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={() => onPanel({ kind: 'notes', row })}
          >
            {entry.notes.trim() ? 'Edit notes' : 'Add notes'}
          </motion.button>
        </div>
      </div>
      <DeleteX
        className="vu-x vu-scene-cast-x"
        hovered={hover}
        label={`Remove ${name}`}
        onDelete={() => store.setRow(row, null)}
      />
    </li>
  )
}

/** The day, half, sky and place the scene is set in. */
function SceneRow({
  draft,
  onPanel
}: {
  draft: SceneDraft
  onPanel: (panel: Panel) => void
}): JSX.Element {
  const store = useSceneCreatorStore.getState()
  const characters = useCharacterStore((s) => s.characters)
  const backgrounds = useAssetStore((s) => s.backgrounds)
  const spriteVersion = useCharacterStore((s) => s.spriteVersion)
  const half = slotHalf(draft.time)
  const wet = draft.weather !== 'clear'

  // A background that is a cast girl's room is drawn from her own pictures.
  const owner =
    draft.bg !== undefined && !allBackgrounds(backgrounds).includes(draft.bg)
      ? draft.rows.find((entry) => entry && characters[entry.charId] && roomBgIdOf(characters[entry.charId]) === draft.bg)
      : undefined
  const bgSrc =
    draft.bg === undefined
      ? null
      : owner
        ? roomUrl(owner.charId, half, spriteVersion[owner.charId] ?? 0)
        : bgThumbUrl(draft.bg, half, wet)

  return (
    <div className="vu-scene-setting">
      <div className="vu-field">
        <span className="vu-field-label">Date</span>
        <motion.button
          id="scene-date"
          className="vu-pill vu-scene-date"
          type="button"
          {...gestures(false, quietLift, quietPress)}
          onClick={() => onPanel({ kind: 'date' })}
        >
          {formatWeekday(draft.date).slice(0, 3)}, {formatGameDate(draft.date, 'spring')}
        </motion.button>
      </div>
      <div className="vu-scene-setting-select">
        <SelectField
          id="scene-time"
          label="Time"
          value={String(draft.time)}
          options={TIME_OPTIONS}
          onChange={(value) => store.setTime(Number(value) as TimeSlot)}
        />
      </div>
      <div className="vu-scene-setting-select">
        <SelectField
          id="scene-weather"
          label="Weather"
          value={draft.weather}
          options={WEATHER_OPTIONS}
          onChange={(value) => store.setWeather(value as Weather)}
        />
      </div>
      <div className="vu-field">
        <span className="vu-field-label">BG</span>
        <BgSlot
          idPrefix="scene"
          src={bgSrc}
          picked={draft.bg !== undefined}
          onPick={() => onPanel({ kind: 'bg' })}
          onClear={() => store.setBg(undefined)}
        />
      </div>
    </div>
  )
}

/** The pronoun select's options, in the order New Game offers them. */
const PRONOUN_OPTIONS = READER_PRONOUNS.map((value) => ({
  value,
  label: READER_PRONOUN_LABELS[value]
}))

/**
 * Who the reader is: his name, his pronouns, his three stats by tier, and his own words about
 * himself.
 */
function ReaderColumn({ draft }: { draft: SceneDraft }): JSX.Element {
  const store = useSceneCreatorStore.getState()
  const { reader } = draft
  const pronouns = asReaderPronouns(reader.pronouns)
  return (
    <section className="vu-scene-reader" aria-label="Reader">
      <h2 className="vu-scene-reader-head">Reader</h2>
      <div className="vu-scene-reader-names">
        <TextField
          id="scene-reader-first"
          label="First name"
          value={reader.firstName}
          placeholder={DEFAULT_PLAYER_FIRST_NAMES[pronouns]}
          maxLength={32}
          onChange={(firstName) => store.patchReader({ firstName })}
        />
        <TextField
          id="scene-reader-last"
          label="Last name"
          value={reader.lastName}
          placeholder={DEFAULT_PLAYER_LAST_NAME}
          maxLength={32}
          onChange={(lastName) => store.patchReader({ lastName })}
        />
      </div>
      <div className="vu-scene-reader-stats">
        <SelectField
          id="scene-reader-pronouns"
          label="Pronouns"
          value={pronouns}
          options={PRONOUN_OPTIONS}
          onChange={(value) => store.patchReader({ pronouns: asReaderPronouns(value) })}
        />
        {STAT_KEYS.map((key) => (
          <SelectField
            key={key}
            id={`scene-reader-${key}`}
            label={STAT_LABELS[key]}
            value={String(reader.tiers[key])}
            options={TIER_OPTIONS}
            onChange={(value) =>
              store.patchReader({ tiers: { ...reader.tiers, [key]: Number(value) as StatTier } })
            }
          />
        ))}
      </div>
      <TextField
        id="scene-reader-bio"
        label="Bio"
        hint="Completes 'The reader is...'"
        value={reader.bio}
        onChange={(bio) => store.patchReader({ bio })}
        multiline
      />
    </section>
  )
}

/** Whichever panel is in front of the screen, wired to the draft. */
function PanelFor({
  panel,
  theme,
  draft,
  onOpenSaved,
  onClose
}: {
  panel: Panel
  theme: ScreenTheme
  draft: SceneDraft
  onOpenSaved: (id: string) => void
  onClose: () => void
}): JSX.Element | null {
  const store = useSceneCreatorStore.getState()
  const characters = useCharacterStore((s) => s.characters)
  const saved = useSceneCreatorStore((s) => s.saved)

  const entryAt = (row: number): SceneCastEntry | null => draft.rows[row] ?? null
  const cast = draft.rows.flatMap((entry) =>
    entry && characters[entry.charId] ? [characters[entry.charId]] : []
  )

  switch (panel.kind) {
    case 'pick':
      return (
        <LoadCharacterModal
          theme={theme}
          taken={cast.map((character) => character.charId)}
          onPick={(character) => {
            store.setRow(panel.row, character)
            onClose()
          }}
          onClose={onClose}
        />
      )
    case 'milestones':
    case 'relations':
    case 'notes': {
      const entry = entryAt(panel.row)
      const character = entry ? characters[entry.charId] : undefined
      if (!entry || !character) return null
      if (panel.kind === 'milestones') {
        return (
          <SceneMilestonesModal
            theme={theme}
            character={character}
            gender={genderOf(character)}
            entry={entry}
            onChange={(milestones) => store.patchRow(panel.row, { milestones })}
            onClose={onClose}
          />
        )
      }
      if (panel.kind === 'relations') {
        return (
          <SceneRelationshipsModal
            theme={theme}
            character={character}
            others={cast.filter((other) => other.charId !== character.charId)}
            pairs={draft.pairs}
            people={Object.fromEntries(
              draft.rows.flatMap((row) => {
                if (!row) return []
                const who = characters[row.charId]
                return [[row.charId, { character: who, flags: flagsOfEntry(row, who) }]]
              })
            )}
            onChange={(other, relation) => store.setRelation(character.charId, other, relation)}
            onClose={onClose}
          />
        )
      }
      return (
        <SceneNotesModal
          theme={theme}
          name={character.firstName}
          value={entry.notes}
          onSave={(notes) => store.patchRow(panel.row, { notes })}
          onClose={onClose}
        />
      )
    }
    case 'date':
      return (
        <DatePickerModal
          theme={theme}
          id="scene-date"
          date={draft.date}
          first={SCENE_FIRST_DATE}
          last={SCENE_LAST_DATE}
          season="spring"
          occasions
          onPick={(date) => store.setDate(date)}
          onClose={onClose}
        />
      )
    case 'bg':
      return (
        <BgPicker
          theme={theme}
          half={slotHalf(draft.time)}
          wet={draft.weather !== 'clear'}
          title="Background"
          label="Where the scene opens"
          picked={draft.bg ?? null}
          rooms={Object.fromEntries(cast.map((character) => [character.charId, character]))}
          // Pressing the one already picked hands the choice back to the writer.
          onPick={(id) => {
            store.setBg(id === draft.bg ? undefined : id)
            onClose()
          }}
          onClose={onClose}
        />
      )
    case 'load':
      return (
        <LoadSceneModal
          theme={theme}
          scenes={saved ?? []}
          characters={characters}
          onOpen={onOpenSaved}
          onDelete={(id) => void store.deleteSaved(id)}
          onClose={onClose}
        />
      )
  }
}
