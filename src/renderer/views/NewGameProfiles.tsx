import { memo, useMemo, useState, type JSX, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  emptyGirl,
  incompleteOf,
  isReturning,
  keptStartMilestones,
  START_DATE_FIRST,
  START_DATE_LAST,
  startLocksOf,
  startMemoriesOf,
  startMilestonesOf,
  startMilestonesWith,
  withGirlChanged,
  withPair,
  withProfileField,
  withPursuit,
  withSecret,
  type ApplicationGirl,
  type DecidedProfile,
  type ProfileField,
  type StartBox,
  type StartMilestones
} from '@shared/application'
import { yearLabel } from '@shared/classes'
import { DORM_IDS, dormLabel, type DormId } from '@shared/dorms'
import { JOB_CATALOG } from '@shared/jobs'
import { ACTIVITY_LOCATIONS, FUN_LOCATIONS, MEAL_LOCATIONS, STUDY_LOCATIONS } from '@shared/locations'
import { pairKeyOf } from '@shared/npcRelationships'
import { DISPOSITION_LABELS } from '@shared/relationship'
import { SCENE_MILESTONES, SCENE_RELATIONS, type SceneRelation } from '@shared/sceneCreator'
import { SECRET_TIERS, secretTiersWanted } from '@shared/secrets'
import { fullNameOf, type Character, type SecretTier } from '@shared/types'
import { CheckField } from '../components/CheckField'
import { DatePill } from '../components/DatePill'
import { SelectField } from '../components/SelectField'
import { SpoilerName } from '../components/Spoiler'
import { TextField } from '../components/TextField'
import {
  revealPick,
  rosterOf,
  updateApplication,
  useApplicationStore,
  useMasked
} from '../stores/applicationStore'
import { useCharacterStore } from '../stores/characterStore'
import { UNKNOWN_NAME } from '../stores/gameStore'
import type { ScreenTheme } from './clockTheme'
import { DatePickerModal } from './DatePickerModal'
import { gestures, quietLift, quietPress } from './motion'
import { EntriesPanel, EntryRow, EntrySection, PaneSection } from './NewGameEntries'
import { BLANK, counts, numberOf, placeOptions, withBlank } from './profileOptions'
import { milestoneLabel } from './SceneMilestonesModal'
import { RELATION_LABELS } from './SceneRelationshipsModal'
import { StartMemoriesModal, startReadingOf } from './StartMemoriesModal'
import '../vu_styles/NewGameProfiles.css'

/** The milestone boxes in the order the screen lists them: met, her number, then the rest. */
const BOXES: readonly StartBox[] = [
  'met',
  'contact',
  ...SCENE_MILESTONES.filter((key) => key !== 'met')
]

/** A modal the screen raises over itself, kept in the flow so it outlives a leave. */
export type ProfileModal =
  | { kind: 'memories'; charId: string }
  | { kind: 'date'; charId: string; field: 'datingSince' | 'brokeUpOn' }

/** Writes one change to one girl into the application. */
function changeGirl(charId: string, change: (girl: ApplicationGirl) => ApplicationGirl): void {
  updateApplication((draft) => {
    const girls = withGirlChanged(draft.girls, charId, change)
    return girls === draft.girls ? draft : { ...draft, girls }
  })
}

/** Writes one profile field of one girl, `undefined` leaving it to generate. */
function setField<F extends ProfileField>(
  charId: string,
  field: F,
  value: DecidedProfile[F] | undefined
): void {
  changeGirl(charId, (girl) => {
    const profile = withProfileField(girl.profile, field, value)
    return profile === girl.profile ? girl : { ...girl, profile }
  })
}

/** Keeps one girl's milestones as given. */
function setMilestones(charId: string, milestones: StartMilestones): void {
  changeGirl(charId, (girl) => {
    const kept = keptStartMilestones(milestones)
    if (JSON.stringify(kept) === JSON.stringify(girl.milestones)) return girl
    const { milestones: _dropped, ...rest } = girl
    return kept ? { ...rest, milestones: kept } : rest
  })
}


/**
 * The Profiles screen's modals — her memories and the dates a lover's or an ex's standing runs
 * from — standing in the flow rather than in the body, which goes before a leave acts.
 * `covered` while one stands.
 */
export function useProfileModals(theme: ScreenTheme): {
  open: (modal: ProfileModal) => void
  modals: ReactNode
  covered: boolean
} {
  const [modal, setModal] = useState<ProfileModal | null>(null)
  const season = useApplicationStore((s) => s.application?.season ?? 'spring')
  const girl = useApplicationStore((s) => (modal ? s.application?.girls[modal.charId] : undefined))
  const character = useCharacterStore((s) => (modal ? s.characters[modal.charId] : undefined))
  const close = (): void => setModal(null)

  let date: number | undefined
  if (modal?.kind === 'date' && girl) date = startMilestonesOf(girl, character)[modal.field]

  const modals = (
    <AnimatePresence>
      {modal?.kind === 'memories' && character && (
        <StartMemoriesModal key="memories" theme={theme} character={character} onClose={close} />
      )}
      {modal?.kind === 'date' && date !== undefined && (
        <DatePickerModal
          key="date"
          theme={theme}
          id="profile-date-picker"
          date={date}
          first={START_DATE_FIRST}
          last={START_DATE_LAST}
          season={season}
          onPick={(picked) => {
            const field = modal.field
            changeGirl(modal.charId, (g) => {
              const shown = startMilestonesOf(g, character)
              const kept = keptStartMilestones({ ...shown, [field]: picked })
              return kept ? { ...g, milestones: kept } : g
            })
          }}
          onClose={close}
        />
      )}
    </AnimatePresence>
  )
  return { open: setModal, modals, covered: modal !== null }
}

interface PaneProps {
  character: Character
  roster: readonly Character[]
  onOpen: (modal: ProfileModal) => void
}

/**
 * Everything the player can set for one girl new to the roster, section by section; spring break
 * only before a spring.
 */
const ProfilePane = memo(function ProfilePane({ character, roster, onOpen }: PaneProps): JSX.Element {
  const charId = character.charId
  const stored = useApplicationStore((s) => s.application?.girls[charId])
  const pairs = useApplicationStore((s) => s.application?.pairs)
  const season = useApplicationStore((s) => s.application?.season ?? 'spring')
  const girl = useMemo(() => stored ?? emptyGirl(), [stored])
  const masked = useMasked()
  const hidden = masked.has(charId)
  const profile = girl.profile
  // Her name wherever it stands inside another control; elsewhere the mask is its own control.
  const name = hidden ? UNKNOWN_NAME : character.firstName
  const reveal = (): void => revealPick(charId)
  const set = <F extends ProfileField>(field: F, value: DecidedProfile[F] | undefined): void =>
    setField(charId, field, value)

  // The decided upperclassman's townhouses and the first two years rule each other out.
  const elysium = profile.dorm === 'elysium'
  const lowerYear = profile.year === 1 || profile.year === 2

  const job = profile.job
  const fun = profile.fun
  const activity = profile.activity

  const shown = startMilestonesOf(girl, character)
  const locks = startLocksOf(girl, character)
  const disposition = startReadingOf(girl, character)
  const memories = startMemoriesOf(girl).length

  return (
    <>
      <div className="vu-entries-head">
        <h2 className="vu-entries-heading">
          {hidden ? <SpoilerName id="profile-spoiler" onReveal={reveal} /> : fullNameOf(character)}
        </h2>
      </div>

      <PaneSection title="Studies">
        <div className="vu-entries-grid">
          <SelectField
            id="profile-year"
            label="Year"
            value={profile.year !== undefined ? String(profile.year) : ''}
            options={withBlank(
              [1, 2, 3, 4].map((year) => ({
                value: String(year),
                label: yearLabel(year),
                disabled: elysium && year < 3
              }))
            )}
            onChange={(value) => set('year', numberOf(value))}
          />
          <TextField
            id="profile-major"
            label="Major"
            value={profile.major ?? ''}
            placeholder={BLANK}
            maxLength={60}
            onChange={(value) => set('major', value === '' ? undefined : value)}
          />
          <SelectField
            id="profile-classes"
            label="Classes taken"
            value={profile.classesTaken !== undefined ? String(profile.classesTaken) : ''}
            options={withBlank(counts(3, 6))}
            onChange={(value) => set('classesTaken', numberOf(value))}
          />
          <SelectField
            id="profile-major-classes"
            label="Classes taken in major"
            value={profile.majorClassesTaken !== undefined ? String(profile.majorClassesTaken) : ''}
            options={withBlank(counts(1, 3))}
            onChange={(value) => set('majorClassesTaken', numberOf(value))}
          />
        </div>
      </PaneSection>

      <PaneSection title="Home and work">
        <div className="vu-entries-grid">
          <SelectField
            id="profile-dorm"
            label="Dorm"
            value={profile.dorm ?? ''}
            options={withBlank(
              [...DORM_IDS.filter((dorm) => dorm !== 'elysium'), 'elysium' as const].map(
                (dorm) => ({
                  value: dorm,
                  label: dormLabel(dorm),
                  disabled: dorm === 'elysium' && lowerYear
                })
              )
            )}
            onChange={(value) => set('dorm', value === '' ? undefined : (value as DormId))}
          />
          <SelectField
            id="profile-nights-in"
            label="Stay home nights per week"
            value={profile.homeSlots !== undefined ? String(profile.homeSlots) : ''}
            options={withBlank(counts(1, 3))}
            onChange={(value) => set('homeSlots', numberOf(value))}
          />
          <SelectField
            id="profile-job"
            label="Job"
            value={job === null ? 'none' : (job?.jobId ?? '')}
            options={withBlank([
              { value: 'none', label: 'No job' },
              ...JOB_CATALOG.map((def) => ({ value: def.id, label: `${def.employer}, ${def.title}` }))
            ])}
            onChange={(value) => {
              const count = job?.count
              if (value === 'none') set('job', null)
              else if (value === '') set('job', count !== undefined ? { count } : undefined)
              else set('job', { jobId: value, ...(count !== undefined ? { count } : {}) })
            }}
          />
          <SelectField
            id="profile-shifts"
            label="Job shifts per week"
            value={job?.count !== undefined ? String(job.count) : ''}
            options={withBlank(counts(1, 2))}
            disabled={job === null}
            onChange={(value) => {
              const count = numberOf(value)
              const jobId = job?.jobId
              if (count === undefined) set('job', jobId ? { jobId } : undefined)
              else set('job', { ...(jobId ? { jobId } : {}), count })
            }}
          />
        </div>
      </PaneSection>

      <PaneSection
        title="Free time"
      >
        <div className="vu-entries-grid">
          <SelectField
            id="profile-study"
            label="Studies at"
            value={profile.study === null ? 'none' : (profile.study ?? '')}
            options={withBlank([{ value: 'none', label: 'Her room' }, ...placeOptions(STUDY_LOCATIONS)])}
            onChange={(value) => set('study', value === 'none' ? null : value === '' ? undefined : value)}
          />
          <SelectField
            id="profile-meal"
            label="Eats out at"
            value={profile.meal === null ? 'none' : (profile.meal ?? '')}
            options={withBlank([{ value: 'none', label: 'Nowhere' }, ...placeOptions(MEAL_LOCATIONS)])}
            onChange={(value) => set('meal', value === 'none' ? null : value === '' ? undefined : value)}
          />
          <SelectField
            id="profile-fun"
            label="Goes out to"
            value={fun === undefined ? '' : fun.length === 0 ? 'none' : fun[0]}
            options={withBlank([{ value: 'none', label: 'Nowhere' }, ...placeOptions(FUN_LOCATIONS)])}
            onChange={(value) => {
              if (value === '') set('fun', undefined)
              else if (value === 'none') set('fun', [])
              else set('fun', fun?.[1] && fun[1] !== value ? [value, fun[1]] : [value])
            }}
          />
          <SelectField
            id="profile-fun-second"
            label="And to"
            value={fun?.[1] ?? ''}
            options={
              fun && fun.length > 0
                ? withBlank(placeOptions(FUN_LOCATIONS, fun[0]), 'Nowhere else')
                : withBlank([])
            }
            disabled={!fun || fun.length === 0}
            onChange={(value) => {
              if (!fun || fun.length === 0) return
              set('fun', value === '' ? [fun[0]] : [fun[0], value])
            }}
          />
          <SelectField
            id="profile-activity"
            label="Weekly activity at"
            value={activity === null ? 'none' : (activity?.location ?? '')}
            options={withBlank([{ value: 'none', label: 'None' }, ...placeOptions(ACTIVITY_LOCATIONS)])}
            onChange={(value) => {
              const doing = activity?.doing
              if (value === 'none') set('activity', null)
              else if (value === '') set('activity', doing ? { doing } : undefined)
              else set('activity', { location: value, ...(doing ? { doing } : {}) })
            }}
          />
          <TextField
            id="profile-activity-doing"
            label="Describe the activity"
            value={activity?.doing ?? ''}
            placeholder={BLANK}
            maxLength={120}
            disabled={activity === null}
            onChange={(value) => {
              const location = activity?.location
              if (value === '') set('activity', location ? { location } : undefined)
              else set('activity', { ...(location ? { location } : {}), doing: value })
            }}
          />
        </div>
      </PaneSection>

      <PaneSection title="Bunnyboard">
        <div className="vu-entries-grid">
          <TextField
            id="profile-handle"
            label="Handle"
            value={profile.handle ?? ''}
            placeholder={BLANK}
            maxLength={30}
            onChange={(value) => set('handle', value === '' ? undefined : value)}
          />
        </div>
      </PaneSection>

      {season === 'spring' && (
        <PaneSection title="Spring break">
          <div className="vu-entries-column">
            <TextField
              id="profile-spring-break"
              label="Plans"
              hint="Like “Drive down to her aunt's place in Texas.”"
              value={profile.springBreakPlans ?? ''}
              placeholder={BLANK}
              maxLength={160}
              onChange={(value) => set('springBreakPlans', value === '' ? undefined : value)}
            />
          </div>
        </PaneSection>
      )}

      <PaneSection
        title="Secrets"
        lines={[
          <>
            Secrets are revealed at the associated disposition level. Use third person and mention her name.
          </>
        ]}
      >
        <div className="vu-entries-column">
          {SECRET_TIERS.map((tier: SecretTier) => (
            <TextField
              key={tier}
              id={`profile-secret-${tier}`}
              label={`Revealed at ${DISPOSITION_LABELS[tier]}`}
              value={girl.secrets[tier] ?? ''}
              placeholder={BLANK}
              maxLength={400}
              multiline
              autoGrow
              onChange={(value) =>
                changeGirl(charId, (g) => {
                  const secrets = withSecret(g.secrets, tier, value)
                  return secrets === g.secrets ? g : { ...g, secrets }
                })
              }
            />
          ))}
        </div>
      </PaneSection>

      <PaneSection
        title="With you"
        lines={['Adding a memory or milestone will automatically set the character to already met.']}
      >
        <div className="vu-profile-checks">
          {BOXES.map((box) => (
            <CheckField
              key={box}
              id={`profile-box-${box}`}
              label={milestoneLabel(box, name)}
              checked={shown[box]}
              disabled={box in locks}
              onChange={(checked) =>
                setMilestones(charId, startMilestonesWith(girl, character, box, checked))
              }
            />
          ))}
        </div>
        <div className="vu-entries-grid">
          {shown.datingSince !== undefined && (
            <DatePill
              id="profile-dating-since"
              label="Dating since"
              date={shown.datingSince}
              season={season}
              onPick={() => onOpen({ kind: 'date', charId, field: 'datingSince' })}
            />
          )}
          {shown.brokeUpOn !== undefined && (
            <DatePill
              id="profile-broke-up-on"
              label="Broke up on"
              date={shown.brokeUpOn}
              season={season}
              onPick={() => onOpen({ kind: 'date', charId, field: 'brokeUpOn' })}
            />
          )}
        </div>
        <div className="vu-profile-memories">
          <motion.button
            id="profile-memories"
            className="vu-pill"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={() => onOpen({ kind: 'memories', charId })}
          >
            {girl.memories.length > 0 ? 'Edit memories' : 'Add memories'}
          </motion.button>
          <span className="vu-profile-reading">
            {memories === 1 ? '1 memory' : `${memories} memories`}
          </span>
          <span id="profile-disposition" className="vu-profile-reading vu-profile-reading--on">
            {disposition ?? 'Not met'}
          </span>
        </div>
      </PaneSection>

      {roster.length > 1 && (
        <PaneSection title="With the others">
          <div className="vu-entries-grid">
            {roster
              .filter((other) => other.charId !== charId)
              .map((other) => {
                const relation = pairs?.[pairKeyOf(charId, other.charId)]
                return (
                  <SelectField
                    key={other.charId}
                    id={`profile-pair-${other.charId}`}
                    label={`${name} and ${masked.has(other.charId) ? UNKNOWN_NAME : other.firstName}`}
                    value={relation ?? ''}
                    options={withBlank(
                      SCENE_RELATIONS.map((value) => ({ value, label: RELATION_LABELS[value] }))
                    )}
                    onChange={(value) =>
                      updateApplication((d) => {
                        const next = withPair(
                          d.pairs,
                          charId,
                          other.charId,
                          value === '' ? null : (value as SceneRelation)
                        )
                        return next === d.pairs ? d : { ...d, pairs: next }
                      })
                    }
                  />
                )
              })}
          </div>
        </PaneSection>
      )}
    </>
  )
})

/**
 * A girl returning from the last semester: nothing of hers is set here, so the pane says what
 * will be generated for her.
 */
const ReturningPane = memo(function ReturningPane({ character }: { character: Character }): JSX.Element {
  const season = useApplicationStore((s) => s.application?.season)
  const carried = useApplicationStore(
    (s) => s.application?.continued?.carry.charInfo[character.charId]
  )
  const tiers = secretTiersWanted(carried)
  const secrets =
    tiers.length === 1 && tiers[0] === 'devoted'
      ? "a new secret revealed at the devoted level."
      : 'her secrets.'
  return (
    <div className="vu-entries-head">
      <h2 className="vu-entries-heading">{fullNameOf(character)}</h2>
      <p className="vu-entries-text">
        {`Returning characters can't be edited.`}
      </p>
      <p className="vu-entries-text">
        {season === 'spring'
          ? `Her break posts and spring break plans will be generated, along with ${secrets}`
          : `Her break posts will be generated, along with ${secrets}`}
      </p>
    </div>
  )
})

/** A girl who graduated at the last ending: what she is doing now, the one thing set for her. */
const GraduatePane = memo(function GraduatePane({ character }: { character: Character }): JSX.Element {
  const charId = character.charId
  const pursuit = useApplicationStore((s) => s.application?.pursuits?.[charId] ?? '')
  return (
    <>
      <div className="vu-entries-head">
        <h2 className="vu-entries-heading">{fullNameOf(character)}</h2>
        <p className="vu-entries-text">
          {`${character.firstName} graduated at the last ceremony and has moved away from Veridan.`}
        </p>
      </div>
      <div className="vu-entries-column">
        <TextField
          id="profile-pursuit"
          label="What she's doing now"
          hint="Like “teaching English in Seoul”."
          value={pursuit}
          placeholder={BLANK}
          maxLength={120}
          onChange={(value) =>
            updateApplication((d) => {
              const pursuits = withPursuit(d.pursuits, charId, value)
              if (pursuits === d.pursuits) return d
              const { pursuits: _dropped, ...rest } = d
              return pursuits ? { ...rest, pursuits } : rest
            })
          }
        />
      </div>
    </>
  )
})

/** What a girl's row says under her name: the year and major the player decided. */
function rowSub(girl: ApplicationGirl | undefined): string | undefined {
  const parts: string[] = []
  if (girl?.profile.year !== undefined) parts.push(yearLabel(girl.profile.year))
  const major = girl?.profile.major?.trim()
  if (major) parts.push(major)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * New Game's Profiles screen: the roster down the list column, each girl with what is decided for
 * her, a warn dot on a half-set pair and her disposition once she knows the reader, and the one
 * picked open beside it as every field the profile call writes, her secrets, where she stands
 * with the reader and with each other girl. On New Game+ a girl returning from the last semester
 * wears a sticker and opens as a note, and the girls who graduated at its ending stand under
 * their own heading, each opening as what she is doing now.
 */
export const NewGameProfiles = memo(function NewGameProfiles({
  onOpen
}: {
  onOpen: (modal: ProfileModal) => void
}): JSX.Element | null {
  const draft = useApplicationStore((s) => s.application)
  const characters = useCharacterStore((s) => s.characters)
  const masked = useMasked()
  const [picked, setPicked] = useState<string | null>(null)

  const chars = draft?.chars
  const continued = draft?.continued
  // Read again whenever a record is rewritten: `rosterOf` reads them out of the character store.
  const roster = useMemo(() => (chars ? rosterOf({ chars }) : []), [chars, characters])
  // The girls who graduated at the ending a New Game+ continues, a deleted one left out.
  const graduates = useMemo(
    () =>
      (continued?.graduated ?? []).flatMap((charId) =>
        characters[charId] ? [characters[charId]] : []
      ),
    [continued, characters]
  )
  const warn = useMemo(
    () =>
      new Set(
        draft
          ? incompleteOf(draft, 'profiles').flatMap((entry) =>
              entry.kind === 'profile' ? [entry.charId] : []
            )
          : []
      ),
    [draft]
  )
  if (!draft || roster.length === 0) return null

  const open = [...roster, ...graduates].find((c) => c.charId === picked) ?? roster[0]

  const side = (
    <>
      <EntrySection title="Characters">
        {roster.map((character) => {
          if (isReturning(draft, character.charId)) {
            const prior = continued?.priorProfiles[character.charId]
            return (
              <EntryRow
                key={character.charId}
                id={`profiles-row-${character.charId}`}
                faceOf={character.charId}
                title={character.firstName}
                sub={prior ? `${yearLabel(prior.year)} · ${prior.major}` : undefined}
                sticker="Returning"
                on={open.charId === character.charId}
                onOpen={() => setPicked(character.charId)}
              />
            )
          }
          const girl = draft.girls[character.charId]
          return (
            <EntryRow
              key={character.charId}
              id={`profiles-row-${character.charId}`}
              faceOf={character.charId}
              masked={masked.has(character.charId)}
              title={masked.has(character.charId) ? UNKNOWN_NAME : character.firstName}
              sub={rowSub(girl)}
              reading={girl ? (startReadingOf(girl, character) ?? undefined) : undefined}
              warn={warn.has(character.charId)}
              on={open.charId === character.charId}
              onOpen={() => setPicked(character.charId)}
            />
          )
        })}
      </EntrySection>
      {graduates.length > 0 && (
        <EntrySection title="Graduates">
          {graduates.map((character) => (
            <EntryRow
              key={character.charId}
              id={`profiles-row-${character.charId}`}
              faceOf={character.charId}
              title={character.firstName}
              sub={continued?.priorProfiles[character.charId]?.major}
              on={open.charId === character.charId}
              onOpen={() => setPicked(character.charId)}
            />
          ))}
        </EntrySection>
      )}
    </>
  )

  let pane: ReactNode
  if (graduates.includes(open)) pane = <GraduatePane character={open} />
  else if (isReturning(draft, open.charId)) pane = <ReturningPane character={open} />
  else pane = <ProfilePane character={open} roster={roster} onOpen={onOpen} />

  return <EntriesPanel side={side} pane={pane} paneKey={open.charId} />
})
