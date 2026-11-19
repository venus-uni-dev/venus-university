import { memo, useMemo, useState, type JSX, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { classGroupLabel, isCourse, type ClassKind } from '@shared/academics'
import type {
  ApplicationDraft,
  FinalClassEdit,
  FinalGirlEdit,
  StartResult
} from '@shared/application'
import { DORM_IDS, dormLabel, type DormId } from '@shared/dorms'
import { pronounsOf } from '@shared/gender'
import { JOB_CATALOG } from '@shared/jobs'
import { ACTIVITY_LOCATIONS, FUN_LOCATIONS, MEAL_LOCATIONS, STUDY_LOCATIONS } from '@shared/locations'
import { DISPOSITION_LABELS } from '@shared/relationship'
import { fullNameOf, type Character, type ClassEntry, type Season } from '@shared/types'
import { ConfirmModal } from '../components/ConfirmModal'
import { SelectField } from '../components/SelectField'
import { SpoilerName } from '../components/Spoiler'
import { TextField } from '../components/TextField'
import { formatShortGameDate } from '../prompts/gameDate'
import {
  finalChangesOf,
  finalFaultsOf,
  finalGirlKindOf,
  finalizedOf,
  finalMajorsOf,
  finalTouched,
  withFinalClass,
  withFinalGirl,
  withFinalMajor,
  withFinalOccasion,
  withoutFinalEdits,
  type FinalChanges,
  type FinalFault,
  type FinalMajor,
  type FinalTarget
} from '../stores/applicationFinalize'
import { revealPick, updateFinalEdits, useApplicationStore, useMasked } from '../stores/applicationStore'
import { useCharacterStore } from '../stores/characterStore'
import { UNKNOWN_NAME } from '../stores/gameStore'
import { monthName } from './calendarMonths'
import type { ScreenTheme } from './clockTheme'
import { fadeIn, gestures, quietLift, quietPress, toggleLift } from './motion'
import { EntriesPanel, EntryRow, EntrySection, PaneSection } from './NewGameEntries'
import { OCCASION_KIND_WORDS, plannedKindOf, whenOf } from './NewGameOccasions'
import { POOL_WORDS } from './NewGameClasses'
import { counts, placeOptions, withBlank, type Option } from './profileOptions'
import { CalendarIcon, CapIcon, PeopleIcon } from './screenIcons'
import '../vu_styles/CourseSchedule.css'
import '../vu_styles/ClassCard.css'

/** Finalize's tabs, in the order they stand, each its mark over its word. */
type FinalTab = 'occasions' | 'characters' | 'classes'
const TABS: readonly { id: FinalTab; word: string; Mark: () => JSX.Element }[] = [
  { id: 'occasions', word: 'Occasions', Mark: CalendarIcon },
  { id: 'characters', word: 'Characters', Mark: PeopleIcon },
  { id: 'classes', word: 'Classes', Mark: CapIcon }
]

/** The rail arriving under the header, built once. */
const RAIL_IN = fadeIn(0.2)

/** The sticker a changed row wears. */
const EDITED = 'Edited'

/** What the interest classes are called on screen. */
const INTEREST_WORDS = 'Interest classes'

/** What major classes dealt for no major in particular are called on screen. */
const MAJORLESS_WORDS = 'Major classes'

/** What the activity's box shows while no composed phrase stands behind it. */
const ACTIVITY_EXAMPLE = 'Include the location, like “sketching at the Whitman Greenhouse”'

/** The line under a renamable major's name. */
const MAJOR_LINE = 'Renaming this major changes it for every character taking it.'

/** What each fault says under the field it is in. */
const FAULT_NOTES = {
  repeated: 'This code is already used. It will be overwritten with a generated one.',
  taken: 'This class code was used in a previous semester. It will be overwritten with a generated one.',
  major: 'Another major already has this name. It will be overwritten with a generated one.',
  handle: 'Handles need at least one letter. It will be overwritten with a generated one.',
  job: 'Please choose the number of shifts per week.',
  activity: 'Please describe the activity.'
} as const

/** A course's kind as its select offers it. */
const KIND_OPTIONS: readonly Option[] = [
  { value: 'lecture', label: classGroupLabel('lecture') },
  { value: 'project', label: classGroupLabel('project') }
]

/** A modal Finalize raises over itself: the undo of one item's changes. */
export interface FinalizeModal {
  target: FinalTarget
  /** What the item is called in the question. */
  name: string
}

/**
 * Finalize's modal, the undo's question, standing in the flow rather than in the body, which goes
 * before a leave acts. `covered` while it stands.
 */
export function useFinalizeModals(theme: ScreenTheme): {
  open: (modal: FinalizeModal) => void
  modals: ReactNode
  covered: boolean
} {
  const [modal, setModal] = useState<FinalizeModal | null>(null)
  const modals = (
    <AnimatePresence>
      {modal && (
        <ConfirmModal
          key="undo"
          id="final-undo-confirm"
          theme={theme}
          title="Undo changes?"
          message={`All changes to ${modal.name} will be lost.`}
          confirmText="Undo changes"
          onCancel={() => setModal(null)}
          onConfirm={() => {
            const target = modal.target
            setModal(null)
            updateFinalEdits((d) => withoutFinalEdits(d, target))
          }}
        />
      )}
    </AnimatePresence>
  )
  return { open: setModal, modals, covered: modal !== null }
}

/** The quiet undo at an item's foot, offered while anything of it is changed. */
function Undo({
  id,
  target,
  name,
  onOpen
}: {
  id: string
  target: FinalTarget
  name: string
  onOpen: (modal: FinalizeModal) => void
}): JSX.Element | null {
  const touched = useApplicationStore((s) => (s.application ? finalTouched(s.application, target) : false))
  if (!touched) return null
  return (
    <div className="vu-entries-actions">
      <motion.button
        id={id}
        className="vu-btn vu-btn--quiet"
        type="button"
        {...gestures(false, quietLift, quietPress)}
        onClick={() => onOpen({ target, name })}
      >
        Undo changes
      </motion.button>
    </div>
  )
}

/** A fault's line under the field it is in. */
function FaultNote({ id, text }: { id: string; text: string }): JSX.Element {
  return (
    <p id={id} className="vu-entries-note">
      <span className="vu-form-dot vu-form-dot--warn" />
      {text}
    </p>
  )
}

/** What Finalize reads of the application on every tab: the semester, its changes and faults. */
interface FinalState {
  draft: ApplicationDraft
  composed: StartResult
  final: StartResult
  changes: FinalChanges
  faults: FinalFault[]
}

/** The application as Finalize stands, worked out once for every change it holds. */
function useFinalState(): FinalState | null {
  const draft = useApplicationStore((s) => s.application)
  return useMemo(() => {
    if (!draft?.composed) return null
    return {
      draft,
      composed: draft.composed,
      final: finalizedOf(draft),
      changes: finalChangesOf(draft),
      faults: finalFaultsOf(draft)
    }
  }, [draft])
}

// ---- occasions --------------------------------------------------------------

/** One invented occasion open in the pane: its kind, its days, and its words to change. */
const OccasionPane = memo(function OccasionPane({
  id,
  season,
  onOpen
}: {
  id: string
  season: Season
  onOpen: (modal: FinalizeModal) => void
}): JSX.Element | null {
  const occasion = useApplicationStore((s) => s.application?.composed?.occasions.find((o) => o.id === id))
  const planned = useApplicationStore((s) => s.application?.plan.find((p) => p.id === id))
  const changed = useApplicationStore((s) => s.application?.finalEdits?.occasions?.[id])
  if (!occasion) return null
  const write = (field: 'title' | 'description', value: string): void =>
    updateFinalEdits((d) => withFinalOccasion(d, id, { [field]: value }))

  return (
    <>
      <div className={`vu-entries-head${planned ? ' vu-entries-head--stickered' : ''}`}>
        {planned && (
          <span className="vu-sticker vu-entries-sticker">{OCCASION_KIND_WORDS[plannedKindOf(planned)]}</span>
        )}
        <p className="vu-entries-when">{whenOf(occasion, season)}</p>
      </div>
      <div className="vu-entries-fields">
        <TextField
          id="final-occasion-title"
          label="Title"
          value={changed?.title ?? occasion.title}
          placeholder={occasion.title}
          maxLength={80}
          onChange={(value) => write('title', value)}
        />
        <TextField
          id="final-occasion-description"
          label="Description"
          value={changed?.description ?? occasion.description}
          placeholder={occasion.description}
          multiline
          autoGrow
          onChange={(value) => write('description', value)}
        />
      </div>
      <Undo id="final-occasion-undo" target={{ occasion: id }} name={occasion.title} onOpen={onOpen} />
    </>
  )
})

/** The Occasions tab: the semester's invented occasions by month, each opening on its words. */
function OccasionsTab({
  state,
  onOpen
}: {
  state: FinalState
  onOpen: (modal: FinalizeModal) => void
}): JSX.Element {
  const [picked, setPicked] = useState<string | null>(null)
  const { draft, final, changes } = state
  const season = draft.season
  const occasions = useMemo(
    () =>
      [...final.occasions].sort(
        (a, b) => a.startDate - b.startDate || (a.time ?? -1) - (b.time ?? -1)
      ),
    [final.occasions]
  )
  const open = occasions.find((occasion) => occasion.id === picked) ?? occasions[0]

  const months: { month: string; items: typeof occasions }[] = []
  for (const occasion of occasions) {
    const month = monthName(occasion.startDate, season)
    const last = months[months.length - 1]
    if (last && last.month === month) last.items.push(occasion)
    else months.push({ month, items: [occasion] })
  }

  const side = months.map(({ month, items }) => (
    <EntrySection key={month} title={month}>
      {items.map((occasion) => (
        <EntryRow
          key={occasion.id}
          id={`final-occasion-row-${occasion.id}`}
          title={occasion.title}
          reading={formatShortGameDate(occasion.startDate, season)}
          sticker={changes.occasions.has(occasion.id) ? EDITED : undefined}
          on={occasion === open}
          onOpen={() => setPicked(occasion.id)}
        />
      ))}
    </EntrySection>
  ))

  const pane = open ? <OccasionPane id={open.id} season={season} onOpen={onOpen} /> : null
  return <EntriesPanel side={side} pane={pane} paneKey={open?.id} />
}

// ---- characters -------------------------------------------------------------

/** Her break posts and secrets as boxes, each over what was composed for it. */
function WordsFields({
  charId,
  composed,
  changed,
  season
}: {
  charId: string
  composed: StartResult
  changed: FinalGirlEdit | undefined
  season: Season
}): JSX.Element {
  const posts = composed.feeds[charId]?.winterPosts ?? []
  const secrets = composed.secrets[charId] ?? []
  const breakName = season === 'spring' ? 'Winter break post' : 'Summer break post'
  return (
    <>
      {posts.length > 0 && (
        <PaneSection title="Break posts">
          <div className="vu-entries-column">
            {posts.map((post, index) => (
              <TextField
                key={index}
                id={`final-post-${index}`}
                label={`${breakName} ${index + 1}`}
                value={changed?.posts?.[String(index)] ?? post}
                placeholder={post}
                maxLength={400}
                multiline
                autoGrow
                onChange={(value) =>
                  updateFinalEdits((d) =>
                    withFinalGirl(d, charId, {
                      posts: { ...d.finalEdits?.girls?.[charId]?.posts, [String(index)]: value }
                    })
                  )
                }
              />
            ))}
          </div>
        </PaneSection>
      )}
      {secrets.length > 0 && (
        <PaneSection title="Secrets">
          <div className="vu-entries-column">
            {secrets.map((secret) => (
              <TextField
                key={secret.tier}
                id={`final-secret-${secret.tier}`}
                label={`Told at ${DISPOSITION_LABELS[secret.tier]}`}
                value={changed?.secrets?.[secret.tier] ?? secret.text}
                placeholder={secret.text}
                maxLength={400}
                multiline
                autoGrow
                onChange={(value) =>
                  updateFinalEdits((d) =>
                    withFinalGirl(d, charId, {
                      secrets: { ...d.finalEdits?.girls?.[charId]?.secrets, [secret.tier]: value }
                    })
                  )
                }
              />
            ))}
          </div>
        </PaneSection>
      )}
    </>
  )
}

/** Her spring break plans before a spring, over what was composed for them. */
function PlansField({
  charId,
  composed,
  changed
}: {
  charId: string
  composed: StartResult
  changed: FinalGirlEdit | undefined
}): JSX.Element {
  const plans = composed.springBreakPlans[charId] ?? ''
  return (
    <PaneSection title="Spring break">
      <div className="vu-entries-column">
        <TextField
          id="final-spring-break"
          label="Plans"
          value={changed?.springBreakPlans ?? plans}
          placeholder={plans}
          maxLength={160}
          onChange={(value) => updateFinalEdits((d) => withFinalGirl(d, charId, { springBreakPlans: value }))}
        />
      </div>
    </PaneSection>
  )
}

/**
 * A girl new to the roster: her home and work, her free time, her handle, posts, spring break
 * plans and secrets, each as it will stand over what was composed for her.
 */
const NewcomerPane = memo(function NewcomerPane({
  character,
  faults
}: {
  character: Character
  faults: readonly FinalFault[]
}): JSX.Element | null {
  const charId = character.charId
  const composed = useApplicationStore((s) => s.application?.composed)
  const changed = useApplicationStore((s) => s.application?.finalEdits?.girls?.[charId])
  const season = useApplicationStore((s) => s.application?.season ?? 'spring')
  if (!composed) return null
  const schedule = composed.schedules.perChar[charId]
  const haunts = composed.haunts[charId]
  const feed = composed.feeds[charId]
  const set = (patch: FinalGirlEdit): void => updateFinalEdits((d) => withFinalGirl(d, charId, patch))
  const faulted = (kind: FinalFault['kind']): boolean =>
    faults.some((fault) => fault.kind === kind && 'charId' in fault && fault.charId === charId)

  const dorm = changed?.dorm ?? schedule?.dorm
  const composedJob = composed.jobs[charId] ?? null
  const job = changed?.job !== undefined ? changed.job : composedJob
  const homeSlots = changed?.homeSlots ?? haunts?.homeSlots
  const study = changed?.study !== undefined ? changed.study : (haunts?.study ?? null)
  const meal = changed?.meal !== undefined ? changed.meal : (haunts?.meal ?? null)
  const fun = changed?.fun ?? haunts?.fun ?? []
  const composedActivity = haunts?.activity ?? null
  const activity = changed?.activity !== undefined ? changed.activity : composedActivity
  // The composed phrase stands behind its box only while the activity is at the composed place.
  const samePlace = activity !== null && activity.location === composedActivity?.location
  const doingPlaceholder = (samePlace ? composedActivity?.doing : undefined) || ACTIVITY_EXAMPLE
  const lowerYear = (schedule?.year ?? 1) < 3

  return (
    <>
      <PaneSection title="Home and work">
        <div className="vu-entries-grid">
          {dorm !== undefined && (
            <SelectField
              id="final-dorm"
              label="Dorm"
              value={dorm}
              options={[...DORM_IDS.filter((id) => id !== 'elysium'), 'elysium' as const].map((id) => ({
                value: id,
                label: dormLabel(id),
                disabled: id === 'elysium' && lowerYear
              }))}
              onChange={(value) => set({ dorm: value as DormId })}
            />
          )}
          {homeSlots !== undefined && (
            <SelectField
              id="final-nights-in"
              label="Nights in a week"
              value={String(homeSlots)}
              options={counts(1, 3)}
              onChange={(value) => set({ homeSlots: Number(value) })}
            />
          )}
          <SelectField
            id="final-job"
            label="Job"
            value={job === null ? 'none' : (job.jobId ?? '')}
            options={[
              { value: 'none', label: 'No job' },
              ...JOB_CATALOG.map((def) => ({ value: def.id, label: `${def.employer}, ${def.title}` }))
            ]}
            onChange={(value) => {
              if (value === 'none') set({ job: null })
              else set({ job: { jobId: value, ...(job?.count !== undefined ? { count: job.count } : {}) } })
            }}
          />
          <SelectField
            id="final-shifts"
            label="Shifts a week"
            value={job?.count !== undefined ? String(job.count) : ''}
            options={job?.count === undefined ? withBlank(counts(1, 2), '') : counts(1, 2)}
            disabled={job === null}
            onChange={(value) => {
              if (!job || value === '') return
              set({ job: { ...(job.jobId ? { jobId: job.jobId } : {}), count: Number(value) } })
            }}
          />
        </div>
        {faulted('job') && <FaultNote id="final-job-fault" text={FAULT_NOTES.job} />}
      </PaneSection>

      {haunts && (
        <PaneSection title="Free time">
          <div className="vu-entries-grid">
            <SelectField
              id="final-study"
              label="Studies at"
              value={study ?? 'none'}
              options={[
                { value: 'none', label: `${pronounsOf(character).Their} room` },
                ...placeOptions(STUDY_LOCATIONS)
              ]}
              onChange={(value) => set({ study: value === 'none' ? null : value })}
            />
            <SelectField
              id="final-meal"
              label="Eats out at"
              value={meal ?? 'none'}
              options={[{ value: 'none', label: 'Nowhere' }, ...placeOptions(MEAL_LOCATIONS)]}
              onChange={(value) => set({ meal: value === 'none' ? null : value })}
            />
            <SelectField
              id="final-fun"
              label="Goes out to"
              value={fun[0] ?? 'none'}
              options={[{ value: 'none', label: 'Nowhere' }, ...placeOptions(FUN_LOCATIONS)]}
              onChange={(value) => {
                if (value === 'none') set({ fun: [] })
                else set({ fun: fun[1] && fun[1] !== value ? [value, fun[1]] : [value] })
              }}
            />
            <SelectField
              id="final-fun-second"
              label="And to"
              value={fun[1] ?? ''}
              options={withBlank(fun.length > 0 ? placeOptions(FUN_LOCATIONS, fun[0]) : [], 'Nowhere else')}
              disabled={fun.length === 0}
              onChange={(value) => {
                if (fun.length === 0) return
                set({ fun: value === '' ? [fun[0]] : [fun[0], value] })
              }}
            />
            <SelectField
              id="final-activity"
              label="Weekly activity at"
              value={activity === null ? 'none' : (activity.location ?? '')}
              options={[{ value: 'none', label: 'None' }, ...placeOptions(ACTIVITY_LOCATIONS)]}
              onChange={(value) => {
                if (value === 'none') {
                  set({ activity: null })
                  return
                }
                // A phrase the player wrote goes with the activity; the composed one names its place.
                const written = changed?.activity?.doing
                set({ activity: { location: value, ...(written ? { doing: written } : {}) } })
              }}
            />
            <div className="vu-entries-wide">
              <TextField
                id="final-activity-doing"
                label="Describe the activity"
                value={activity?.doing ?? ''}
                placeholder={doingPlaceholder}
                maxLength={120}
                disabled={activity === null}
                onChange={(value) => {
                  if (activity === null) return
                  set({ activity: { ...(activity.location ? { location: activity.location } : {}), doing: value } })
                }}
              />
            </div>
          </div>
          {faulted('activity') && <FaultNote id="final-activity-fault" text={FAULT_NOTES.activity} />}
        </PaneSection>
      )}

      {feed && (
        <PaneSection title="Bunnyboard">
          <div className="vu-entries-grid">
            <TextField
              id="final-handle"
              label="Handle"
              value={changed?.handle ?? feed.handle}
              placeholder={feed.handle}
              maxLength={30}
              onChange={(value) => set({ handle: value })}
            />
          </div>
          {faulted('handle') && <FaultNote id="final-handle-fault" text={FAULT_NOTES.handle} />}
        </PaneSection>
      )}

      {season === 'spring' && <PlansField charId={charId} composed={composed} changed={changed} />}
      <WordsFields charId={charId} composed={composed} changed={changed} season={season} />
    </>
  )
})

/** A girl returning from the last semester: her break posts, spring break plans and new secrets. */
const ReturningPane = memo(function ReturningPane({ charId }: { charId: string }): JSX.Element | null {
  const composed = useApplicationStore((s) => s.application?.composed)
  const changed = useApplicationStore((s) => s.application?.finalEdits?.girls?.[charId])
  const season = useApplicationStore((s) => s.application?.season ?? 'spring')
  if (!composed) return null
  return (
    <>
      {season === 'spring' && <PlansField charId={charId} composed={composed} changed={changed} />}
      <WordsFields charId={charId} composed={composed} changed={changed} season={season} />
    </>
  )
})

/** A graduate: what she is doing now, and her break posts. */
const GraduatePane = memo(function GraduatePane({
  character
}: {
  character: Character
}): JSX.Element | null {
  const charId = character.charId
  const composed = useApplicationStore((s) => s.application?.composed)
  const changed = useApplicationStore((s) => s.application?.finalEdits?.girls?.[charId])
  const season = useApplicationStore((s) => s.application?.season ?? 'spring')
  if (!composed) return null
  const pursuit = composed.pursuits?.[charId] ?? ''
  return (
    <>
      <div className="vu-entries-column">
        <TextField
          id="final-pursuit"
          label={`What ${character.firstName} is doing now`}
          value={changed?.pursuit ?? pursuit}
          placeholder={pursuit}
          maxLength={120}
          onChange={(value) => updateFinalEdits((d) => withFinalGirl(d, charId, { pursuit: value }))}
        />
      </div>
      <WordsFields charId={charId} composed={composed} changed={changed} season={season} />
    </>
  )
})

/**
 * The Characters tab: the roster face first, then on New Game+ the graduates, each opening on
 * what was composed for her; a masked random pick's fields are held back until she is revealed.
 */
function CharactersTab({
  state,
  onOpen
}: {
  state: FinalState
  onOpen: (modal: FinalizeModal) => void
}): JSX.Element | null {
  const characters = useCharacterStore((s) => s.characters)
  const masked = useMasked()
  const [picked, setPicked] = useState<string | null>(null)
  const { draft, composed, changes, faults } = state

  const roster = useMemo(
    () => draft.chars.flatMap((charId) => (characters[charId] ? [characters[charId]] : [])),
    [draft.chars, characters]
  )
  const graduates = useMemo(
    () =>
      (draft.continued?.alumni ?? []).flatMap((charId) =>
        composed.pursuits?.[charId] !== undefined && characters[charId] ? [characters[charId]] : []
      ),
    [draft.continued, composed.pursuits, characters]
  )
  const warned = useMemo(
    () => new Set(faults.flatMap((fault) => ('charId' in fault ? [fault.charId] : []))),
    [faults]
  )
  if (roster.length === 0) return null
  const open = [...roster, ...graduates].find((c) => c.charId === picked) ?? roster[0]

  const row = (character: Character): JSX.Element => {
    const hidden = masked.has(character.charId)
    return (
      <EntryRow
        key={character.charId}
        id={`final-girl-row-${character.charId}`}
        faceOf={character.charId}
        masked={hidden}
        title={hidden ? UNKNOWN_NAME : character.firstName}
        warn={warned.has(character.charId)}
        sticker={changes.girls.has(character.charId) ? EDITED : undefined}
        on={open.charId === character.charId}
        onOpen={() => setPicked(character.charId)}
      />
    )
  }
  const side = (
    <>
      <EntrySection title="Characters">{roster.map(row)}</EntrySection>
      {graduates.length > 0 && <EntrySection title="Graduates">{graduates.map(row)}</EntrySection>}
    </>
  )

  const charId = open.charId
  const hidden = masked.has(charId)
  const kind = finalGirlKindOf(draft, charId)
  let body: ReactNode = null
  if (hidden) {
    body = <p className="vu-entries-text">Content hidden to avoid spoilers. Click the eye icon to show.</p>
  } else if (kind === 'newcomer') {
    body = <NewcomerPane character={open} faults={faults} />
  } else if (kind === 'returning') {
    body = <ReturningPane charId={charId} />
  } else if (kind === 'graduate') {
    body = <GraduatePane character={open} />
  }
  const pane = (
    <>
      <div className="vu-entries-head">
        <h2 className="vu-entries-heading">
          {hidden ? (
            <SpoilerName id="final-spoiler" onReveal={() => revealPick(charId)} />
          ) : (
            fullNameOf(open)
          )}
        </h2>
      </div>
      {body}
      {!hidden && (
        <Undo id="final-girl-undo" target={{ girl: charId }} name={open.firstName} onOpen={onOpen} />
      )}
    </>
  )
  return <EntriesPanel side={side} pane={pane} paneKey={charId} />
}

// ---- classes ----------------------------------------------------------------

/** What the Classes tab's pane is open on: a category, a major by name, or majorless classes. */
type ClassesPick = 'pe' | 'humanities' | 'arts' | 'misc' | 'interest' | 'majorless' | `major:${string}`

/** The categories that stand before the majors, in order. */
const CATEGORIES = ['pe', 'humanities', 'arts', 'misc', 'interest'] as const

/** What a category is called on screen. */
function categoryWords(category: (typeof CATEGORIES)[number]): string {
  return category === 'interest' ? INTEREST_WORDS : POOL_WORDS[category]
}

/** The composed classes a pick holds, by code. */
function classesOf(composed: StartResult, pick: ClassesPick): ClassEntry[] {
  const all = Object.values(composed.schedules.classes)
  const held = pick.startsWith('major:')
    ? all.filter((entry) => entry.category === 'major' && entry.major === pick.slice('major:'.length))
    : pick === 'majorless'
      ? all.filter((entry) => entry.category === 'major' && entry.major === undefined)
      : all.filter((entry) => entry.category === pick)
  return held.sort((a, b) => a.code.localeCompare(b.code))
}

/** One class as a card: its code, title, a course's kind and its description, over the composed. */
const FinalClassCard = memo(function FinalClassCard({
  code,
  label,
  fault,
  onOpen
}: {
  code: string
  label: string
  fault: 'repeated' | 'taken' | null
  onOpen: (modal: FinalizeModal) => void
}): JSX.Element | null {
  const entry = useApplicationStore((s) => s.application?.composed?.schedules.classes[code])
  const changed = useApplicationStore((s) => s.application?.finalEdits?.classes?.[code])
  if (!entry) return null
  const write = (patch: FinalClassEdit): void => updateFinalEdits((d) => withFinalClass(d, code, patch))
  const course = isCourse(entry)
  const kind: ClassKind | undefined = course ? (changed?.kind ?? entry.kind) : undefined
  const shownCode = changed?.code?.trim() || entry.code
  const id = `final-class-${code.replace(/[^A-Za-z0-9]+/g, '-')}`

  return (
    <div id={id} className="vu-classcard">
      <div className="vu-classcard-head">
        <span className="vu-classcard-label">{label}</span>
        <span className="vu-code vu-classcard-code" data-group={course ? kind : 'pe'}>
          {shownCode}
        </span>
      </div>
      <TextField
        id={`${id}-code`}
        label="Code"
        value={changed?.code ?? entry.code}
        placeholder={entry.code}
        maxLength={16}
        onChange={(value) => write({ code: value })}
      />
      <TextField
        id={`${id}-title`}
        label="Title"
        value={changed?.name ?? entry.name}
        placeholder={entry.name}
        maxLength={80}
        onChange={(value) => write({ name: value })}
      />
      {course && kind && (
        <SelectField
          id={`${id}-kind`}
          label="Lecture or project"
          value={kind}
          options={KIND_OPTIONS}
          onChange={(value) => write({ kind: value as ClassKind })}
        />
      )}
      <TextField
        id={`${id}-description`}
        label="Description"
        value={changed?.description ?? entry.description}
        placeholder={entry.description}
        multiline
        autoGrow
        onChange={(value) => write({ description: value })}
      />
      {fault && <FaultNote id={`${id}-fault`} text={FAULT_NOTES[fault]} />}
      <Undo id={`${id}-undo`} target={{ class: code }} name={entry.code} onOpen={onOpen} />
    </div>
  )
})

/** A renamable major's name over its cards, its fault said under it. */
function MajorName({ major, faulted }: { major: FinalMajor; faulted: boolean }): JSX.Element {
  const typed = useApplicationStore((s) => s.application?.finalEdits?.majors?.[major.name])
  return (
    <div className="vu-entries-fields">
      <TextField
        id="final-major"
        label="Major"
        hint={MAJOR_LINE}
        value={typed ?? major.name}
        placeholder={major.name}
        maxLength={60}
        onChange={(value) => updateFinalEdits((d) => withFinalMajor(d, major.name, value))}
      />
      {faulted && <FaultNote id="final-major-fault" text={FAULT_NOTES.major} />}
    </div>
  )
}

/**
 * The Classes tab: the categories, then every major and any major classes of no major, each with
 * how many classes it holds, opening on its classes as cards two across; a major's own name heads
 * its pane where no returning girl holds it.
 */
function ClassesTab({
  state,
  onOpen
}: {
  state: FinalState
  onOpen: (modal: FinalizeModal) => void
}): JSX.Element {
  const [picked, setPicked] = useState<ClassesPick>('pe')
  const { draft, composed, changes, faults } = state
  const majors = useMemo(() => finalMajorsOf(draft), [draft])
  const majorless = useMemo(() => classesOf(composed, 'majorless').length > 0, [composed])

  const codeFaults = new Map(
    faults.flatMap((fault) => (fault.kind === 'code' ? [[fault.code, fault.why] as const] : []))
  )
  const majorFaults = new Set(faults.flatMap((fault) => (fault.kind === 'major' ? [fault.major] : [])))

  /** What a pick's row shows of its classes: whether any changed, and whether any is faulted. */
  const marks = (pick: ClassesPick, major?: string): { edited: boolean; warn: boolean } => {
    const held = classesOf(composed, pick)
    return {
      edited: held.some((entry) => changes.classes.has(entry.code)) || (major !== undefined && changes.majors.has(major)),
      warn: held.some((entry) => codeFaults.has(entry.code)) || (major !== undefined && majorFaults.has(major))
    }
  }

  // A category the composed catalog holds nothing in is left off.
  const categories = CATEGORIES.filter((category) => classesOf(composed, category).length > 0)
  const pickedMajor = picked.startsWith('major:') ? picked.slice('major:'.length) : null
  const openMajor = pickedMajor !== null ? (majors.find((m) => m.name === pickedMajor) ?? null) : null
  const stale =
    (pickedMajor !== null && !openMajor) ||
    (picked === 'majorless' && !majorless) ||
    (pickedMajor === null && picked !== 'majorless' && !categories.includes(picked as (typeof CATEGORIES)[number]))
  const open: ClassesPick = stale ? (categories[0] ?? 'pe') : picked

  const side = (
    <>
      <EntrySection title="Classes">
        {categories.map((category) => {
          const mark = marks(category)
          return (
            <EntryRow
              key={category}
              id={`final-classes-row-${category}`}
              title={categoryWords(category)}
              reading={String(classesOf(composed, category).length)}
              warn={mark.warn}
              sticker={mark.edited ? EDITED : undefined}
              on={open === category}
              onOpen={() => setPicked(category)}
            />
          )
        })}
      </EntrySection>
      <EntrySection title="Majors">
        {majors.map((major, n) => {
          const mark = marks(`major:${major.name}`, major.name)
          const typed = draft.finalEdits?.majors?.[major.name]?.trim()
          return (
            <EntryRow
              key={major.name}
              id={`final-classes-row-major-${n}`}
              title={typed || major.name}
              reading={String(classesOf(composed, `major:${major.name}`).length)}
              warn={mark.warn}
              sticker={mark.edited ? EDITED : undefined}
              on={openMajor?.name === major.name}
              onOpen={() => setPicked(`major:${major.name}`)}
              data={{ 'data-major': major.name }}
            />
          )
        })}
        {majorless && (
          <EntryRow
            id="final-classes-row-majorless"
            title={MAJORLESS_WORDS}
            reading={String(classesOf(composed, 'majorless').length)}
            warn={marks('majorless').warn}
            sticker={marks('majorless').edited ? EDITED : undefined}
            on={open === 'majorless'}
            onOpen={() => setPicked('majorless')}
          />
        )}
      </EntrySection>
    </>
  )

  const held = classesOf(composed, open)
  const title =
    openMajor?.name ?? (open === 'majorless' ? MAJORLESS_WORDS : categoryWords(open as (typeof CATEGORIES)[number]))
  const pane = (
    <>
      <div className="vu-entries-head">
        <h2 className="vu-entries-heading">{title}</h2>
      </div>
      {openMajor?.renamable && <MajorName major={openMajor} faulted={majorFaults.has(openMajor.name)} />}
      <div className="vu-classes-grid">
        {held.map((entry, index) => (
          <FinalClassCard
            key={entry.code}
            code={entry.code}
            label={`Class ${index + 1}`}
            fault={codeFaults.get(entry.code) ?? null}
            onOpen={onOpen}
          />
        ))}
      </div>
    </>
  )
  return <EntriesPanel side={side} pane={pane} paneKey={open} />
}

/**
 * New Game's Finalize screen: a rail of tabs — Occasions, Characters, Classes — beside one panel,
 * each tab a list of what the semester was composed with beside the one picked open on its fields,
 * a changed row wearing a sticker and one that cannot be kept the warn dot.
 */
export function NewGameFinalize({ onOpen }: { onOpen: (modal: FinalizeModal) => void }): JSX.Element | null {
  const [tab, setTab] = useState<FinalTab>('occasions')
  const state = useFinalState()
  if (!state) return null

  return (
    <div className="vu-newgame-tabbed">
      <motion.div
        className="vu-palette vu-palette--column vu-newgame-tabs"
        role="tablist"
        aria-label="Finalize"
        variants={RAIL_IN}
        initial="hidden"
        animate="shown"
      >
        {TABS.map((entry) => {
          const on = tab === entry.id
          return (
            <motion.button
              key={entry.id}
              id={`final-tab-${entry.id}`}
              className={`vu-palette-btn${on ? ' vu-palette-btn--on' : ''}`}
              type="button"
              role="tab"
              aria-selected={on}
              {...gestures(false, toggleLift, quietPress)}
              onClick={() => setTab(entry.id)}
            >
              <entry.Mark />
              {entry.word}
            </motion.button>
          )
        })}
      </motion.div>
      {tab === 'occasions' && <OccasionsTab state={state} onOpen={onOpen} />}
      {tab === 'characters' && <CharactersTab state={state} onOpen={onOpen} />}
      {tab === 'classes' && <ClassesTab state={state} onOpen={onOpen} />}
    </div>
  )
}
