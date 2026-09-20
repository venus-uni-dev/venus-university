import { Fragment, useState, type JSX, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { slotPartsOf, yearLabel } from '@shared/classes'
import { dormLabel } from '@shared/dorms'
import { jobDefOf, WEEK_DAY_HEADERS } from '@shared/jobs'
import { OUTFIT_SET_LABELS, OUTFIT_SETS, spriteRef } from '@shared/outfits'
import { npcEnemiesOf, npcFriendsOf } from '@shared/npcRelationships'
import { STAT_ATTRACTIONS } from '@shared/playerStats'
import {
  affectionFor,
  dedupedMemories,
  emptyFlags,
  isPositive,
  isTrusted,
  loveLifeBlurb,
  memoriesFor,
  memorySentence,
  relationshipTagOf,
  MEMORY_CAP
} from '@shared/relationship'
import { isCharacterTrait } from '@shared/traits'
import { fullNameOf, type OutfitSet } from '@shared/types'
import { formatShortGameDate } from '../prompts/gameDate'
import { useBunnyboardStore } from '../stores/bunnyboardStore'
import { profileUrl, spriteUrl, useSpriteVersion } from '../stores/characterStore'
import { newestFirst } from '../stores/feedRolls'
import { useGameStore } from '../stores/gameStore'
import { noNsfwImagesOf, useSettingsStore } from '../stores/settingsStore'
import { sendFriendRequest } from '../stores/textingLoop'
import {
  breatheDecor,
  dealt,
  fadeIn,
  gestures,
  lift,
  press,
  quietLift,
  quietPress,
  silhouetteIn,
  slideInQuick
} from './motion'
import { BackIcon, MoonIcon, SunIcon } from './screenIcons'
import '../vu_styles/ContactPage.css'

/** The one thing a stranger's every locked slot names, since it is the one thing he can do. */
const AFTER_ADDING = '??? — Unlocked after adding'

/** The reading arriving beside her, and the three cards dealt into it. Module scope. */
const SIDE_IN = fadeIn(0.14, 0.4)
const CARDS_DEAL = dealt(0.22, 0.07)

/**
 * A contact's page: the character is the screen, in an archway bleeding off two stage edges,
 * with three independently-scrolling half-pills carrying everything known about her.
 */
export function ContactPage({ charId }: { charId: string }): JSX.Element {
  const character = useGameStore((s) => s.characters[charId])
  const info = useGameStore((s) => s.charInfo[charId])
  const classes = useGameStore((s) => s.classes)
  const characters = useGameStore((s) => s.characters)
  const chars = useGameStore((s) => s.chars)
  const npcRelationships = useGameStore((s) => s.npcRelationships)
  const npcFriendships = useGameStore((s) => s.npcFriendships)
  // The whole map, for the other half of a pair: `info` is only ever this girl's.
  const charInfo = useGameStore((s) => s.charInfo)
  const playerSchedule = useGameStore((s) => s.playerSchedule)
  const date = useGameStore((s) => s.date)
  const requestsSent = useGameStore((s) => s.bunnyboard.requestsSent)
  const closePage = useBunnyboardStore((s) => s.closePage)
  const version = useSpriteVersion(charId)
  const noNsfwImages = useSettingsStore(noNsfwImagesOf)
  // Which wardrobe she is standing in, which is the screen's own state and nothing the save keeps.
  const [outfit, setOutfit] = useState<OutfitSet | null>(null)

  if (!character) return <p className="vu-contact-gone">This account no longer exists.</p>

  // The list the tag is computed from, texting memory and all; the history reads it folded.
  const memories = memoriesFor(info)
  const history = dedupedMemories(memories)
  // Sorted *after* the fold, so which of two identical entries survives does not move. The
  // fold is oldest-first with a day's entries in the order they were laid down, and a memory
  // carries no half, so within a date the later-laid-down entry reads first: night over day.
  const recent = history
    .map((memory, index) => ({ memory, index }))
    .sort((a, b) => b.memory.date - a.memory.date || b.index - a.index)
    .map(({ memory }) => memory)
  // The tag goes through `affectionFor`, never a sum of the memories: feed likes count too.
  const flags = info?.flags ?? emptyFlags()
  const isContact = Boolean(flags.gaveContactInfo)
  const handle = info?.handle
  const feed = [...(info?.feed ?? [])].sort(newestFirst)
  // The days she made a friend, among what she posted. The other girl has to be one the
  // reader can name — a stranger is omitted rather than masked, as everywhere else.
  const made = npcFriendships.flatMap((pair) => {
    if (pair.a !== charId && pair.b !== charId) return []
    const other = pair.a === charId ? pair.b : pair.a
    const who = characters[other]
    if (!who || !charInfo[other]?.nameKnown) return []
    return [{ pair, other, name: who.firstName }]
  })
  // One list, sorted once: both are dated things on the same card.
  const entries = [
    ...feed.map((post) => ({ kind: 'post' as const, post, date: post.date, time: post.time })),
    ...made.map((entry) => ({ kind: 'made' as const, ...entry, date: entry.pair.date, time: entry.pair.time }))
  ].sort(newestFirst)
  const dorm = info ? dormLabel(info.dorm) : ''
  const affection = affectionFor(info, date, character)
  const tag = relationshipTagOf(flags, affection)
  // Each reveal shows on its persisted flag OR the live condition.
  const traits = (character.traits ?? []).filter(isCharacterTrait)
  const showTraits = traits.length > 0 && (flags.knowsTraits || isPositive(affection))
  const showBackstory = Boolean(character.backstory) && (flags.knowsBackstory || isTrusted(affection))
  // Rides `knowsBackstory`: same threshold, same one-way rule.
  const showPreferred = flags.knowsBackstory || isTrusted(affection)
  // The same paragraph the prompts are given.
  const loveLife = loveLifeBlurb(character, flags)
  const showLoveLife = Boolean(loveLife) && (flags.knowsLoveLife || flags.isLover)
  // Her friends are published like any other field of her page, met or not.
  const known = chars.filter((id) => Boolean(characters[id]))
  const friends = npcFriendsOf(npcRelationships, charId, known)
  const enemies = showBackstory ? npcEnemiesOf(npcRelationships, charId, known) : []
  // Her shifts, once she has actually taken the job.
  const job = info?.job
  const employer = job && (job.startsOn ?? 0) <= date ? jobDefOf(job.jobId)?.employer : undefined
  const shifts = employer ? (job?.shifts ?? []) : []
  // One timetable, classes and shifts together, in slot order — a class dropped from the save
  // is simply not listed.
  const schedule = [
    ...Object.entries(info?.schedule ?? {})
      .map(([slot, code]) => [Number(slot), code, classes[code]] as const)
      .filter(([, , entry]) => Boolean(entry))
      .map(([slot, code, entry]) => ({
        slot,
        text: entry.name,
        withYou: playerSchedule?.[slot] === code
      })),
    ...shifts.map((slot) => ({ slot, text: `Shift at ${employer}`, withYou: false }))
  ].sort((a, b) => a.slot - b.slot)

  // Only what a scene has actually put her in (the save's `seenOutfits`), and never
  // the nude set while the reader has asked not to be shown one.
  const seen = OUTFIT_SETS.filter((set) => !(set === 'nude' && noNsfwImages))
  const wearing = outfit && info?.seenOutfits?.includes(outfit) ? outfit : null

  return (
    <div className="vu-contact">
      {/* Written FIRST, so her archway paints over the profile card's round end: the pill runs
          on behind her and its words begin clear of the picture. */}
      <motion.div className="vu-contact-side" variants={SIDE_IN}>
        <div className="vu-contact-head">
          <div className="vu-contact-lockup">
            {/* The first name large over its own blob, the surname a letterspaced mono strip —
                the card caption's anatomy at page size, so a long name fits the same shape. */}
            <div className="vu-title vu-contact-title">
              <h2 className="vu-title-text">{character.firstName}</h2>
            </div>
            <div className="vu-contact-surname">{character.lastName}</div>
          </div>

          <div className="vu-contact-facts">
            {handle && <div className="vu-contact-handle">@{handle}</div>}
            {info?.major && (
              <div className="vu-contact-line">
                {yearLabel(info.year)} · {info.major}
                {dorm ? ` · ${dorm}` : ''}
              </div>
            )}
          </div>

          {/* What the reader calls her. **No lamp and no location**: a page is a record of who
              she is, and where she is right now is the thread's business and the map's. */}
          {isContact && (
            <div className="vu-bb-tag vu-contact-tag" data-tag={tag.toLowerCase().replace(/\s+/g, '-')}>
              {tag}
            </div>
          )}
        </div>

        {/* Undiscovered is drawn rather than hidden (D4), and a stranger's page is that rule
            carried to the whole screen: every card stands with the one thing that would open it
            named, so nothing she has none of can be read out of an absence. */}
        <motion.div className="vu-contact-cards" variants={CARDS_DEAL}>
          <Card className="vu-contact-card--profile" label="Profile">
            {isContact ? (
              <>
                <Field label="Likes">
                  <Chips words={character.likes ?? []} empty="Nothing you know of." />
                </Field>
                <Field label="Dislikes">
                  <Chips words={character.dislikes ?? []} empty="Nothing you know of." tone="deep" />
                </Field>

                {/* Named at Friend, and named only — the vocabulary is a set of switches the code
                    branches on and is never glossed. */}
                {traits.length > 0 && (
                  <Field label= 'Traits'>
                    {showTraits ? (
                      <Chips words={traits} tone="accent" mono />
                    ) : (
                      <Locked>??? — Unlocked at Friends</Locked>
                    )}
                  </Field>
                )}

                {/* Undiscovered is drawn, never hidden: the slot says what would open it (D4). */}
                <Field label="Her type">
                  {showPreferred ? (
                    <p className="vu-contact-text">
                      {character.firstName} likes guys with {STAT_ATTRACTIONS[character.preferredStat]}.
                    </p>
                  ) : (
                    <Locked>??? — Unlocked at Best Friends</Locked>
                  )}
                </Field>

                {character.backstory && (
                  <Field label="Backstory">
                    {showBackstory ? (
                      <p className="vu-contact-text">{character.backstory}</p>
                    ) : (
                      <Locked>??? — Unlocked at Best Friends</Locked>
                    )}
                  </Field>
                )}

                {loveLife && (
                  <Field label="Love life">
                    {showLoveLife ? (
                      <p className="vu-contact-text">{loveLife}</p>
                    ) : (
                      <Locked>??? — Unlocked at Lovers</Locked>
                    )}
                  </Field>
                )}

                {friends.length > 0 && (
                  <Field label="Friends">
                    <div className="vu-contact-faces">
                      {friends.map((id) => (
                        <FaceChip key={id} charId={id} name={fullNameOf(characters[id])} />
                      ))}
                    </div>
                  </Field>
                )}

                {/* Absent below `trusted` and when she has none: never a heading over a blank. */}
                {enemies.length > 0 && (
                  <Field label="Enemies">
                    <div className="vu-contact-faces">
                      {enemies.map((id) => (
                        <FaceChip key={id} charId={id} name={fullNameOf(characters[id])} bad />
                      ))}
                    </div>
                  </Field>
                )}

                <Field label="Schedule">
                  {schedule.length === 0 ? (
                    <p className="vu-contact-empty">Nothing scheduled.</p>
                  ) : (
                    <div className="vu-contact-week">
                      {schedule.map((row) => {
                        const { weekday, night } = slotPartsOf(row.slot)
                        return (
                          <Fragment key={row.slot}>
                            <span className="vu-contact-when">
                              {WEEK_DAY_HEADERS[weekday].toUpperCase()}
                              {night ? (
                                <MoonIcon className="vu-contact-half-mark" strokeWidth={2.75} />
                              ) : (
                                <SunIcon className="vu-contact-half-mark" strokeWidth={2.75} />
                              )}
                            </span>
                            <span>
                              {row.text}
                              {row.withYou && (
                                <span className="vu-contact-withyou"> (with you)</span>
                              )}
                            </span>
                          </Fragment>
                        )
                      })}
                    </div>
                  )}
                </Field>
              </>
            ) : (
              <StrangerProfile />
            )}
          </Card>

          {/* The count is what she *published*, so the friendship notices below are not in it:
              they are the app saying something about her, not a post of hers. */}
          <Card label={isContact ? `Feed · ${feed.length}` : 'Feed'}>
            {!isContact ? (
              <Locked>{AFTER_ADDING}</Locked>
            ) : entries.length === 0 ? (
              <p className="vu-contact-empty">No posts yet.</p>
            ) : (
              <ul className="vu-contact-feed">
                {entries.map((entry) =>
                  entry.kind === 'made' ? (
                    // Dated like a post and **carrying no like**: there is nothing here she
                    // said, so there is nothing to answer.
                    <li className="vu-contact-made" key={`friends:${entry.pair.a}|${entry.pair.b}`}>
                      Became friends with {entry.name}.{' '}
                      <span className="vu-contact-when">
                        {formatShortGameDate(entry.pair.date)}
                      </span>
                    </li>
                  ) : (
                    <li key={entry.post.id}>
                      {entry.post.text}{' '}
                      <motion.button
                        className={`vu-contact-like${entry.post.liked ? ' vu-contact-like--on' : ''}`}
                        type="button"
                        aria-pressed={Boolean(entry.post.liked)}
                        {...gestures(false, quietLift, quietPress)}
                        onClick={() => useGameStore.getState().toggleFeedLike(charId, entry.post.id)}
                      >
                        {formatShortGameDate(entry.post.date)} · ♥{' '}
                        {entry.post.likes + (entry.post.liked ? 1 : 0)}
                      </motion.button>
                    </li>
                  )
                )}
              </ul>
            )}
          </Card>

          <Card
            label={isContact ? `Memories · ${history.length} of ${MEMORY_CAP}` : 'Memories'}
          >
            {!isContact ? (
              <Locked>{AFTER_ADDING}</Locked>
            ) : history.length === 0 ? (
              <p className="vu-contact-empty">Nothing yet.</p>
            ) : (
              // Newest first, and the date is a column rather than a suffix: a list read from
              // the top down is read in the order things happened to them.
              <div className="vu-contact-memories">
                {recent.map((memory, index) => (
                  <Fragment key={`${memory.date}-${index}`}>
                    <span className="vu-contact-when">{formatShortGameDate(memory.date)}</span>
                    <span>“{memorySentence(character.firstName, memory)}”</span>
                  </Fragment>
                ))}
              </div>
            )}
          </Card>
        </motion.div>

        {/* The foot's own order — the quiet leave first, the primary rightmost — sized to
            their own words: neither grows to a full-width slab, a page not being a form to
            be submitted. */}
        <div className="vu-foot vu-contact-foot">
          <motion.button
            id={`bb-close-${charId}`}
            className="vu-btn vu-btn--quiet"
            type="button"
            {...gestures(false, quietLift, quietPress)}
            onClick={() => useBunnyboardStore.getState().closeApp()}
          >
            Close
          </motion.button>
          {isContact ? (
            <motion.button
              id={`bb-message-${charId}`}
              className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
              type="button"
              {...gestures(false, lift, press)}
              onClick={() => {
                // Jump straight into the thread, creating it on first text.
                useBunnyboardStore.getState().setTab('chats')
                useBunnyboardStore.getState().viewChar(charId)
              }}
            >
              Message
            </motion.button>
          ) : (
            // Somebody he found on the feed: the one thing he can do is ask.
            <motion.button
              id={`bb-add-${charId}`}
              className="vu-btn vu-btn--primary vu-btn--panel vu-paper"
              type="button"
              disabled={requestsSent.includes(charId)}
              {...gestures(requestsSent.includes(charId), lift, press)}
              onClick={() => sendFriendRequest(charId)}
            >
              {requestsSent.includes(charId) ? 'Requested' : 'Add Friend'}
            </motion.button>
          )}
        </div>
      </motion.div>

      {/* She arrives from the left, and the arch behind her breathes — the screen's idle. */}
      <motion.div className="vu-contact-her" variants={silhouetteIn}>
        <motion.div className="vu-contact-arch vu-contact-arch--back" animate={breatheDecor} />
        <div className="vu-contact-arch vu-contact-arch--front" />
        <img
          className="vu-contact-sprite"
          src={spriteUrl(charId, spriteRef('neutral', wearing), version)}
          alt=""
        />
        {/* The band closes her leg crop, fills the corner and seats the switcher — one shape,
            three jobs (D4). */}
        <div className="vu-contact-band" />
      </motion.div>

      {/* What she has been seen wearing, and what has still to be (the save's
          `seenOutfits`). An unseen wardrobe is a dashed slot rather than a missing chip:
          undiscovered is drawn. */}
      <motion.div className="vu-contact-switch" variants={SIDE_IN}>
        {/* One voice for the row: the wardrobe screen's own words, and a slot she has not
            been seen in adds the `???` rather than changing register. */}
        <OutfitChip on={wearing === null} onPick={() => setOutfit(null)}>
          DEFAULT
        </OutfitChip>
        {seen.map((set) =>
          info?.seenOutfits?.includes(set) ? (
            <OutfitChip key={set} on={wearing === set} onPick={() => setOutfit(set)}>
              {OUTFIT_SET_LABELS[set].toUpperCase()}
            </OutfitChip>
          ) : (
            <span key={set} className="vu-contact-outfit vu-contact-outfit--locked">
              {OUTFIT_SET_LABELS[set].toUpperCase()} ???
            </span>
          )
        )}
      </motion.div>

      <motion.button
        className="vu-circle vu-contact-back"
        type="button"
        aria-label="Back"
        {...gestures(false, quietLift, quietPress)}
        onClick={closePage}
      >
        <BackIcon />
      </motion.button>
    </div>
  )
}

/**
 * One of the three cards: a surface half-pill flat right that scrolls on its own, so no one
 * section can outgrow the page. It carries the real scrollbar (`base.css`), never a drawn one.
 */
function Card({
  label,
  className,
  children
}: {
  label: string
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <motion.section
      className={`vu-contact-card${className ? ` ${className}` : ''}`}
      variants={slideInQuick}
    >
      <div className="vu-contact-scroll">
        <h3 className="vu-contact-label">{label}</h3>
        {children}
      </div>
      <div className="vu-scroll-fade" />
    </motion.section>
  )
}

/**
 * A stranger's profile: a **fixed slate**, not a reading of her. Every field is shown locked
 * with what unlocks it named, never omitted — an absence here would tell the reader something
 * he has no way of knowing.
 */
function StrangerProfile(): JSX.Element {
  return (
    <>
      <Field label="Likes">
        <Locked>{AFTER_ADDING}</Locked>
      </Field>
      <Field label="Dislikes">
        <Locked>{AFTER_ADDING}</Locked>
      </Field>
      <Field label="Traits">
        <Locked>??? — Unlocked at Friends</Locked>
      </Field>
      <Field label="Her type">
        <Locked>??? — Unlocked at Best Friends</Locked>
      </Field>
      <Field label="Backstory">
        <Locked>??? — Unlocked at Best Friends</Locked>
      </Field>
      <Field label="Love life">
        <Locked>??? — Unlocked at Lovers</Locked>
      </Field>
      <Field label="Friends">
        <Locked>{AFTER_ADDING}</Locked>
      </Field>
      <Field label="Schedule">
        <Locked>{AFTER_ADDING}</Locked>
      </Field>
    </>
  )
}

/** One titled section inside the profile card. */
function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="vu-contact-field">
      <h4 className="vu-contact-sub">{label}</h4>
      {children}
    </div>
  )
}

/** A run of small facts, or the one line saying there are none. */
function Chips({
  words,
  empty,
  tone,
  mono
}: {
  words: readonly string[]
  empty?: string
  tone?: 'deep' | 'accent'
  mono?: boolean
}): JSX.Element {
  if (words.length === 0) {
    return <p className="vu-contact-empty">{empty ?? 'Nothing you know of.'}</p>
  }
  return (
    <div className="vu-contact-chips">
      {words.map((word) => (
        <span
          key={word}
          className={`vu-contact-chip${tone ? ` vu-contact-chip--${tone}` : ''}${
            mono ? ' vu-contact-chip--mono' : ''
          }`}
        >
          {word}
        </span>
      ))}
    </div>
  )
}

/** Something she has not told him yet, drawn as the gap it is with its own condition named. */
function Locked({ children }: { children: ReactNode }): JSX.Element {
  return <p className="vu-contact-locked">{children}</p>
}

/** One name she is close to, or at odds with: her face on a pill, which opens that girl's page. */
function FaceChip({
  charId,
  name,
  bad
}: {
  charId: string
  name: string
  bad?: boolean
}): JSX.Element {
  const version = useSpriteVersion(charId)
  const openPage = useBunnyboardStore((s) => s.openPage)
  return (
    <motion.button
      className={`vu-contact-face${bad ? ' vu-contact-face--bad' : ''}`}
      type="button"
      aria-label={`Open ${name}`}
      {...gestures(false, quietLift, quietPress)}
      onClick={() => openPage(charId)}
    >
      <span className="vu-arch vu-contact-facepic">
        <span className="vu-crop">
          <img className="vu-crop-img" src={profileUrl(charId, version)} alt="" />
        </span>
      </span>
      {name}
    </motion.button>
  )
}

/** One wardrobe she has been seen in. The one in force is filled; a fill is a state, so its
    hover is a scale rather than a tint. */
function OutfitChip({
  on,
  onPick,
  children
}: {
  on: boolean
  onPick: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <motion.button
      className={`vu-contact-outfit${on ? ' vu-contact-outfit--on' : ''}`}
      type="button"
      aria-pressed={on}
      {...gestures(false, quietLift, quietPress)}
      onClick={onPick}
    >
      {children}
    </motion.button>
  )
}
