import { Fragment, memo, useMemo, useState, type JSX, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { classGroupLabel, type ClassKind } from '@shared/academics'
import {
  CATALOG_POOLS,
  CLASSES_PER_MAJOR,
  POOL_SIZES,
  catalogEntryAt,
  courseFilled,
  incompleteOf,
  repeatedCodesOf,
  withCatalogEntry,
  type CatalogEntries,
  type CatalogEntry,
  type CatalogPool,
  type CatalogSpot
} from '@shared/application'
import type { Character } from '@shared/types'
import { SelectField } from '../components/SelectField'
import { MaskedFace, SpoilerName } from '../components/Spoiler'
import { TextField } from '../components/TextField'
import {
  majorsNow,
  retryCalls,
  revealPick,
  rosterOf,
  updateApplication,
  useApplicationStore,
  useMasked
} from '../stores/applicationStore'
import { profileUrl, useCharacterStore, useSpriteVersion } from '../stores/characterStore'
import { SWIM_CLASS } from '../stores/classScheduler'
import { UNKNOWN_NAME } from '../stores/gameStore'
import { useLorebookStore } from '../stores/lorebookStore'
import { gestures, quietLift, quietPress, slideInQuick, spin } from './motion'
import { EntriesPanel, EntryRow, EntrySection } from './NewGameEntries'
import '../vu_styles/CourseSchedule.css'
import '../vu_styles/ClassCard.css'

/** What each pool is called on screen. */
export const POOL_WORDS: Record<CatalogPool, string> = {
  pe: 'PE',
  humanities: 'Humanities',
  arts: 'Arts',
  misc: 'Miscellaneous'
}

/** What the interest classes are called on screen. */
const INTEREST_WORDS = 'Interest classes'

/** What PE's pane adds. */
const SWIM_LINE = `One PE class you leave blank may become ${SWIM_CLASS.name}.`

/** What the interest classes' pane says. */
const INTEREST_LINE = 'Each character spawns one interest class unique to their tastes.'

/** What every field here shows while it is blank. */
const BLANK = 'Leave blank to generate'

/** A course's kind as the select offers it, blank first. */
const KIND_OPTIONS: readonly { value: '' | ClassKind; label: string }[] = [
  { value: '', label: BLANK },
  { value: 'lecture', label: classGroupLabel('lecture') },
  { value: 'project', label: classGroupLabel('project') }
]

/** A card's blank entry, before anything is written in it. */
const BLANK_ENTRY: CatalogEntry = { code: '', title: '', description: '' }

/** The majors no card reads while none is known yet. */
const NO_MAJORS: ReadonlySet<string> = new Set()

/** What the pane is open on: a pool, the interest classes, or one major by name. */
type ClassesPick = CatalogPool | 'interest' | `major:${string}`

/** One major as the list draws it: its name and its girls in roster order. */
interface MajorItem {
  name: string
  girls: Character[]
}

/** The repeated codes last worked out, so every card on screen reads one set per catalog. */
let repeatedCache: {
  catalog: CatalogEntries
  chars: readonly string[]
  majors: ReadonlySet<string>
  codes: Set<string>
} | null = null

/** The catalog's repeated codes, worked out once for each catalog, roster and set of majors. */
function repeatedCodes(
  catalog: CatalogEntries,
  chars: readonly string[],
  majors: ReadonlySet<string>
): Set<string> {
  const cached = repeatedCache
  if (cached && cached.catalog === catalog && cached.chars === chars && cached.majors === majors) {
    return cached.codes
  }
  const codes = repeatedCodesOf(catalog, chars, majors)
  repeatedCache = { catalog, chars, majors, codes }
  return codes
}

/**
 * Every roster girl's major by charId as the application stands, or null while one is unknown
 * or a resume is still reading. Worked out again only when what the majors come from changes,
 * never the catalog.
 */
function useMajors(): Record<string, string> | null {
  const girls = useApplicationStore((s) => s.application?.girls)
  const chars = useApplicationStore((s) => s.application?.chars)
  const skipped = useApplicationStore((s) => s.application?.skipped)
  const dealtMajors = useApplicationStore((s) => s.application?.dealtMajors)
  const replies = useApplicationStore((s) => s.application?.replies)
  const resuming = useApplicationStore((s) => s.resuming)
  const characters = useCharacterStore((s) => s.characters)
  const setting = useLorebookStore((s) => s.setting)
  const book = useLorebookStore((s) => s.book)
  return useMemo(
    () => (resuming ? null : majorsNow()),
    [girls, chars, skipped, dealtMajors, replies, characters, resuming, setting, book]
  )
}

/** The majors the roster takes, alphabetical, each with the girls who take it. */
function majorItemsOf(majors: Record<string, string>, roster: readonly Character[]): MajorItem[] {
  const byMajor = new Map<string, Character[]>()
  for (const girl of roster) {
    const major = majors[girl.charId]
    if (!major) continue
    byMajor.set(major, [...(byMajor.get(major) ?? []), girl])
  }
  return [...byMajor.entries()]
    .map(([name, girls]) => ({ name, girls }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Who takes a major, as a sentence: each girl setup masks standing as the mask that lifts. */
function TakenBy({
  girls,
  masked
}: {
  girls: readonly Character[]
  masked: ReadonlySet<string>
}): JSX.Element {
  return (
    <>
      Taken by{' '}
      {girls.map((girl, index) => (
        <Fragment key={girl.charId}>
          {index > 0 && (index === girls.length - 1 ? ' and ' : ', ')}
          {masked.has(girl.charId) ? (
            <SpoilerName onReveal={() => revealPick(girl.charId)} />
          ) : (
            girl.firstName
          )}
        </Fragment>
      ))}
      .
    </>
  )
}

/** How many of a list's first `slots` entries are whole, as the list reads it. */
function wholeOf(entries: readonly CatalogEntry[], slots: number, pe: boolean): string {
  const whole = entries.slice(0, slots).filter((entry) => courseFilled(entry, pe)).length
  return `${whole}/${slots}`
}

/** Where a card's entry sits in the catalog. */
function spotOf(pool?: CatalogPool, major?: string, index = 0, charId?: string): CatalogSpot {
  if (charId !== undefined) return { interest: charId }
  if (major !== undefined) return { major, index }
  return { pool: pool ?? 'pe', index }
}

interface ClassCardProps {
  /** What the card's ids are built on, `pe-3`, `major-0-1` or `interest-<charId>`. */
  spotId: string
  pool?: CatalogPool
  major?: string
  index?: number
  /** Whose interest class this is. */
  charId?: string
  /** The card's head: its place in its section, or her first name. */
  label: string
  majors: ReadonlySet<string>
}

/**
 * One catalog entry as a card: its code, title, a course's kind and its description, each
 * written into the application as it is typed, and a line where its code is used twice or an
 * earlier semester ran a class under it.
 */
const ClassCard = memo(function ClassCard({
  spotId,
  pool,
  major,
  index = 0,
  charId,
  label,
  majors
}: ClassCardProps): JSX.Element {
  const spot = useMemo(() => spotOf(pool, major, index, charId), [pool, major, index, charId])
  const pe = pool === 'pe'
  const entry = useApplicationStore((s) =>
    s.application ? catalogEntryAt(s.application.catalog, spot) : undefined
  )
  const repeated = useApplicationStore((s) => {
    const draft = s.application
    if (!draft) return false
    const own = catalogEntryAt(draft.catalog, spot)
    if (!courseFilled(own, pe)) return false
    return repeatedCodes(draft.catalog, draft.chars, majors).has(own.code.trim())
  })
  // A code a class an earlier semester ran already has.
  const ran = useApplicationStore((s) => {
    const draft = s.application
    const taken = draft?.continued?.taken
    if (!draft || !taken) return false
    const own = catalogEntryAt(draft.catalog, spot)
    if (!courseFilled(own, pe)) return false
    const code = own.code.trim()
    return taken.some((entry) => entry.code === code)
  })
  const version = useSpriteVersion(charId)
  const hidden = useMasked().has(charId ?? '')

  /** Writes one field as typed over the entry as it stands. */
  const write = (patch: Partial<CatalogEntry>): void =>
    updateApplication((d) => {
      const before = catalogEntryAt(d.catalog, spot) ?? BLANK_ENTRY
      const catalog = withCatalogEntry(d.catalog, spot, { ...before, ...patch })
      return catalog === d.catalog ? d : { ...d, catalog }
    })

  const id = `class-${spotId}`
  const code = entry?.code.trim() ?? ''

  return (
    <div id={id} className="vu-classcard">
      <div className="vu-classcard-head">
        {charId !== undefined && (
          <span className="vu-arch vu-classcard-face">
            {hidden ? (
              <MaskedFace />
            ) : (
              <span className="vu-crop">
                <img className="vu-crop-img" src={profileUrl(charId, version)} alt="" />
              </span>
            )}
          </span>
        )}
        <span className={`vu-classcard-label${charId !== undefined ? ' vu-classcard-label--name' : ''}`}>
          {hidden && charId !== undefined ? (
            <SpoilerName id={`${id}-spoiler`} onReveal={() => revealPick(charId)} />
          ) : (
            label
          )}
        </span>
        {code && (
          <span className="vu-code vu-classcard-code" data-group={pe ? 'pe' : entry?.kind}>
            {code}
          </span>
        )}
      </div>

      <TextField
        id={`${id}-code`}
        label="Code"
        value={entry?.code ?? ''}
        placeholder={BLANK}
        maxLength={16}
        onChange={(value) => write({ code: value })}
      />
      <TextField
        id={`${id}-title`}
        label="Title"
        value={entry?.title ?? ''}
        placeholder={BLANK}
        maxLength={80}
        onChange={(value) => write({ title: value })}
      />
      {!pe && (
        <SelectField
          id={`${id}-kind`}
          label="Lecture or project"
          value={entry?.kind ?? ''}
          options={KIND_OPTIONS}
          onChange={(value) =>
            write({ kind: value === 'lecture' || value === 'project' ? value : undefined })
          }
        />
      )}
      <TextField
        id={`${id}-description`}
        label="Description"
        value={entry?.description ?? ''}
        placeholder={BLANK}
        multiline
        autoGrow
        onChange={(value) => write({ description: value })}
      />

      {ran ? (
        <p id={`${id}-taken`} className="vu-entries-note">
          <span className="vu-form-dot vu-form-dot--warn" />
          This class code was used previously and will be renumbered.
        </p>
      ) : (
        repeated && (
          <p id={`${id}-repeat`} className="vu-entries-note">
            <span className="vu-form-dot vu-form-dot--warn" />
            This code is used twice and will be renumbered.
          </p>
        )
      )}
    </div>
  )
})

/** What the pane says over its cards: the section's name and the lines about it. */
function PaneHead({ title, lines }: { title: string; lines: readonly ReactNode[] }): JSX.Element {
  return (
    <div className="vu-entries-head">
      <h2 className="vu-entries-heading">{title}</h2>
      {lines.map((line, index) => (
        <p key={index} className="vu-entries-text">
          {line}
        </p>
      ))}
    </div>
  )
}

/**
 * New Game's Classes screen: the pools, the interest classes and every major the roster takes
 * down the list column, each with how many of its classes are whole, and the one picked open
 * beside it as cards two across. The majors wait in their place until every one is known.
 */
export const NewGameClasses = memo(function NewGameClasses(): JSX.Element | null {
  const draft = useApplicationStore((s) => s.application)
  const failure = useApplicationStore((s) => s.calls.profiles.failed)
  const characters = useCharacterStore((s) => s.characters)
  const masked = useMasked()
  const majors = useMajors()
  const [picked, setPicked] = useState<ClassesPick>('pe')

  const chars = draft?.chars
  // Read again whenever a record is rewritten: `rosterOf` reads them out of the character store.
  const roster = useMemo(() => (chars ? rosterOf({ chars }) : []), [chars, characters])
  const majorItems = useMemo(() => (majors ? majorItemsOf(majors, roster) : null), [majors, roster])
  const majorsSet = useMemo(() => (majors ? new Set(Object.values(majors)) : null), [majors])
  const incomplete = useMemo(
    () => (draft ? incompleteOf(draft, 'classes', majorsSet ?? undefined) : []),
    [draft, majorsSet]
  )
  if (!draft) return null

  const catalog = draft.catalog
  const cardMajors = majorsSet ?? NO_MAJORS
  const warnPools = new Set(incomplete.flatMap((entry) => (entry.kind === 'course' ? [entry.pool] : [])))
  const warnMajors = new Set(incomplete.flatMap((entry) => (entry.kind === 'major' ? [entry.major] : [])))
  const warnInterest = incomplete.some((entry) => entry.kind === 'interest')

  // A major no longer taken leaves the pane on PE.
  const pickedMajor = picked.startsWith('major:') ? picked.slice('major:'.length) : null
  const openMajor =
    pickedMajor !== null ? (majorItems?.find((item) => item.name === pickedMajor) ?? null) : null
  const open: ClassesPick = pickedMajor !== null && !openMajor ? 'pe' : picked

  const interestWhole = roster.filter((girl) => courseFilled(catalog.interest[girl.charId], false)).length

  const side = (
    <>
      <EntrySection title="Classes">
        {CATALOG_POOLS.map((pool) => (
          <EntryRow
            key={pool}
            id={`classes-row-${pool}`}
            title={POOL_WORDS[pool]}
            reading={wholeOf(catalog[pool], POOL_SIZES[pool], pool === 'pe')}
            warn={warnPools.has(pool)}
            on={open === pool}
            onOpen={() => setPicked(pool)}
          />
        ))}
        <EntryRow
          id="classes-row-interest"
          title={INTEREST_WORDS}
          reading={`${interestWhole}/${roster.length}`}
          warn={warnInterest}
          on={open === 'interest'}
          onOpen={() => setPicked('interest')}
        />
      </EntrySection>

      <EntrySection title="Majors">
        {majorItems ? (
          majorItems.map((item, n) => (
            <EntryRow
              key={item.name}
              id={`classes-row-major-${n}`}
              title={item.name}
              sub={item.girls
                .map((girl) => (masked.has(girl.charId) ? UNKNOWN_NAME : girl.firstName))
                .join(', ')}
              reading={wholeOf(catalog.major[item.name] ?? [], CLASSES_PER_MAJOR, false)}
              warn={warnMajors.has(item.name)}
              on={openMajor?.name === item.name}
              onOpen={() => setPicked(`major:${item.name}`)}
              data={{ 'data-major': item.name }}
            />
          ))
        ) : failure ? (
          <motion.li id="classes-majors-failed" className="vu-entries-failed" variants={slideInQuick}>
            <p className="vu-entries-failed-text">{failure.message}</p>
            <motion.button
              id="classes-majors-retry"
              className="vu-btn vu-btn--quiet"
              type="button"
              {...gestures(false, quietLift, quietPress)}
              onClick={retryCalls}
            >
              Retry
            </motion.button>
          </motion.li>
        ) : (
          <motion.li id="classes-majors-wait" className="vu-entries-wait" variants={slideInQuick}>
            <motion.span className="vu-ring" animate={spin} />
            Generating majors
          </motion.li>
        )}
      </EntrySection>
    </>
  )

  let pane: ReactNode
  if (open === 'interest') {
    pane = (
      <>
        <PaneHead title={INTEREST_WORDS} lines={[INTEREST_LINE]} />
        <div className="vu-classes-grid">
          {roster.map((girl) => (
            <ClassCard
              key={girl.charId}
              spotId={`interest-${girl.charId}`}
              charId={girl.charId}
              label={girl.firstName}
              majors={cardMajors}
            />
          ))}
        </div>
      </>
    )
  } else if (openMajor && majorItems) {
    const n = majorItems.indexOf(openMajor)
    pane = (
      <>
        <PaneHead
          title={openMajor.name}
          lines={[<TakenBy girls={openMajor.girls} masked={masked} />]}
        />
        <div className="vu-classes-grid">
          {Array.from({ length: CLASSES_PER_MAJOR }, (_, index) => (
            <ClassCard
              key={index}
              spotId={`major-${n}-${index}`}
              major={openMajor.name}
              index={index}
              label={`Class ${index + 1}`}
              majors={cardMajors}
            />
          ))}
        </div>
      </>
    )
  } else {
    const pool = open as CatalogPool
    const lines = pool === 'pe' ? [SWIM_LINE] : []
    pane = (
      <>
        <PaneHead title={POOL_WORDS[pool]} lines={lines} />
        <div className="vu-classes-grid">
          {Array.from({ length: POOL_SIZES[pool] }, (_, index) => (
            <ClassCard
              key={index}
              spotId={`${pool}-${index}`}
              pool={pool}
              index={index}
              label={`Class ${index + 1}`}
              majors={cardMajors}
            />
          ))}
        </div>
      </>
    )
  }

  return <EntriesPanel side={side} pane={pane} paneKey={open} />
})
