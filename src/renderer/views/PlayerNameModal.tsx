import { useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import {
  MAX_TIER,
  MIN_TIER,
  STARTING_TIER,
  STAT_KEYS,
  STAT_LABELS,
  statsForTiers,
  tierNameOf,
  tierOf,
  type StatKey,
  type StatTier
} from '@shared/playerStats'
import type { ApplicationReader } from '@shared/application'
import {
  asReaderPronouns,
  READER_PRONOUN_LABELS,
  READER_PRONOUNS,
  type ReaderPronouns
} from '@shared/gender'
import { DEFAULT_PLAYER_FIRST_NAMES, DEFAULT_PLAYER_LAST_NAME } from '@shared/types'
import { readerYearLine } from '../prompts/setting'
import { useReaderPicture } from '../components/ReaderPictureArch'
import { SelectField } from '../components/SelectField'
import { useModalShell } from '../components/useModalShell'
import { TextField } from '../components/TextField'
import { TitleTab } from '../components/TitleTab'
import type { PictureHome } from '../stores/loop/profilePicture'
import { gestures, lift, panelUnderTab, press, quietLift, quietPress, veilIn } from './motion'
import '../vu_styles/PlayerName.css'

/** One shape for all three: same box, same weight, same joins. */
const MARK = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

/**
 * The three stats' own marks, Lucide-shaped and drawn in `currentColor` so the word beside
 * each takes its identity colour with it. Drawn here rather than in a `*Icons.tsx`
 * because one screen wants them: a mark moves out on its second caller, not its first.
 */
const statIcons: Record<StatKey, () => JSX.Element> = {
  brain: () => (
    <svg {...MARK} aria-hidden="true">
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7V18h8v-3.3A7 7 0 0 0 12 2Z" />
    </svg>
  ),
  body: () => (
    <svg {...MARK} aria-hidden="true">
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </svg>
  ),
  heart: () => (
    <svg {...MARK} aria-hidden="true">
      <path d="M19.5 5.5a5 5 0 0 0-7.5.6 5 5 0 0 0-7.5-.6 5.3 5.3 0 0 0 0 7.4l7.5 7.6 7.5-7.6a5.3 5.3 0 0 0 0-7.4Z" />
    </svg>
  )
}

/** The reader as the modal answers: every value given, the bio blank where none was written. */
export type NamedReader = Required<ApplicationReader>

/** The pronoun select's options, in the order they are offered. */
const PRONOUN_OPTIONS = READER_PRONOUNS.map((value) => ({
  value,
  label: READER_PRONOUN_LABELS[value]
}))

export interface PlayerNameModalProps {
  onSubmit: (reader: NamedReader) => void
  /** Whether the bio, the stat rows and the picture are on offer; Quickstart asks the name alone. */
  askDetails?: boolean
  /** Where the reader's picture is kept while the modal edits it; absent offers no picture. */
  picture?: PictureHome
  /** Drawn by the screen that opened this — a portal inherits neither palette nor state rules. */
  theme: 'day' | 'night'
  /** The answers given before, which a New Game reopened on its wait asks again from. */
  initial?: ApplicationReader
}

/** A name as its box shows it: the default is the placeholder, so it opens blank. */
function shownName(name: string | undefined, fallback: string): string {
  return name === undefined || name === fallback ? '' : name
}

/**
 * Names the reader, takes down his pronouns and what he says about himself, his picture and his
 * opening stat tiers, while the class catalog generates behind it. **Dismissing it is confirming
 * it**: every value already has an answer — blank means the name shown, untouched means the
 * floor, and the bio and the picture may be left out — so the dimming, Escape and the button all
 * commit.
 */
export function PlayerNameModal({
  onSubmit,
  askDetails = true,
  picture,
  theme,
  initial
}: PlayerNameModalProps): JSX.Element | null {
  const [pronouns, setPronouns] = useState<ReaderPronouns>(() =>
    asReaderPronouns(initial?.pronouns)
  )
  const [firstName, setFirstName] = useState(() =>
    shownName(initial?.firstName, DEFAULT_PLAYER_FIRST_NAMES[asReaderPronouns(initial?.pronouns)])
  )
  const [lastName, setLastName] = useState(() =>
    shownName(initial?.lastName, DEFAULT_PLAYER_LAST_NAME)
  )
  const [bio, setBio] = useState(initial?.bio ?? '')
  const [tiers, setTiers] = useState<Record<StatKey, StatTier>>(() =>
    initial
      ? {
          brain: tierOf(initial.stats.brain),
          body: tierOf(initial.stats.body),
          heart: tierOf(initial.stats.heart)
        }
      : { brain: STARTING_TIER, body: STARTING_TIER, heart: STARTING_TIER }
  )

  function step(key: StatKey, delta: 1 | -1): void {
    setTiers((prev) => ({ ...prev, [key]: (prev[key] + delta) as StatTier }))
  }

  /** Placeholders are real values: a blank field submits the name shown. */
  function submit(): void {
    onSubmit({
      firstName: firstName.trim() || DEFAULT_PLAYER_FIRST_NAMES[pronouns],
      lastName: lastName.trim() || DEFAULT_PLAYER_LAST_NAME,
      pronouns,
      stats: statsForTiers(tiers),
      bio: bio.trim()
    })
  }

  // Offered on the full flow alone, where a playthrough folder keeps it.
  const pictureControl = useReaderPicture(theme, picture ?? NO_PICTURE, 'player-picture-input')
  const { host, overlayProps, primaryProps } = useModalShell(submit, 'panel', submit)
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
        <motion.form
          id="player-name"
          className="vu-who vu-paper"
          role="dialog"
          aria-modal="true"
          aria-label="Who are you?"
          variants={panelUnderTab}
          // A form, so Enter in either field is the answer the foot gives; the shell gives it to
          // Enter and Space outside the fields.
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          {...primaryProps}
        >
          <TitleTab>Who are you?</TitleTab>

          {askDetails && picture && (
            <div className="vu-who-picture">
              <span className="vu-field-label">Profile picture</span>
              {pictureControl.arch}
              <span className="vu-who-whisper">Optional</span>
            </div>
          )}

          <div className="vu-who-names">
            {/* Focus lands on the first field, which is what a form dialog opens on. */}
            <TextField
              id="player-first-name"
              label="First name"
              value={firstName}
              onChange={setFirstName}
              placeholder={DEFAULT_PLAYER_FIRST_NAMES[pronouns]}
              maxLength={32}
              autoFocus
            />
            <TextField
              id="player-last-name"
              label="Last name"
              value={lastName}
              onChange={setLastName}
              placeholder={DEFAULT_PLAYER_LAST_NAME}
              maxLength={32}
            />
            <SelectField
              id="player-pronouns"
              label="Pronouns"
              value={pronouns}
              options={PRONOUN_OPTIONS}
              onChange={(value) => setPronouns(asReaderPronouns(value))}
            />
          </div>
          <p className="vu-who-whisper">
            You won't be able to change your name or pronouns later.
          </p>

          {/* Dropped rather than locked on the canned start, which asks the name alone. */}
          {askDetails && (
            <>
              <TextField
                id="player-bio"
                label="Bio"
                value={bio}
                onChange={setBio}
                multiline
                rows={3}
                placeholder="Optional, can be left blank. You can change this at any time in-game."
                hint={`This is put in every prompt so try to keep it short and sweet. Use third-person past tense and continue this paragraph: ${readerYearLine('<Name>', 0, pronouns)} The reader is <description based on selected stats>. The reader is...`}
              />
              <div className="vu-who-stats">
                <span className="vu-field-label">Starting stats</span>
                {STAT_KEYS.map((key) => {
                  const Icon = statIcons[key]
                  return (
                    <div className={`vu-who-stat vu-who-stat--${key}`} key={key}>
                      <span className="vu-who-stat-name">
                        <Icon />
                        {STAT_LABELS[key]}
                      </span>
                      <Step statKey={key} tier={tiers[key]} step={-1} onStep={step} />
                      {/* The tier by name, never the points behind it. */}
                      <span className="vu-who-stat-tier">{tierNameOf(tiers[key])}</span>
                      <Step statKey={key} tier={tiers[key]} step={1} onStep={step} />
                    </div>
                  )
                })}
              </div>
              <p className="vu-who-whisper">
                Unremarkable is recommended. Godly is the maximum tier.
              </p>
            </>
          )}

          {/* One answer, because there is no second one to offer: every value is already the
              answer, so a Cancel beside it would be a way of losing nothing. */}
          <div className="vu-foot">
            <motion.button
              id="player-name-submit"
              className="vu-btn vu-btn--primary vu-paper vu-btn--panel"
              type="submit"
              {...gestures(false, lift, press)}
            >
              Confirm
            </motion.button>
          </div>
        </motion.form>
      </motion.div>
      {pictureControl.modals}
    </>,
    host
  )
}

/** The home the hook is handed where the modal offers no picture: nothing kept, nothing to do. */
const NO_PICTURE: PictureHome = {
  crop: null,
  openStored: () => Promise.resolve(null),
  save: () => Promise.resolve(false),
  remove: () => Promise.resolve()
}

/**
 * One end of a stat's scale. Dead at its own end and rendered there anyway — the square
 * against the end of the scale is the reason, the way a slider's end-stop is, and a
 * button that vanished at the limit would move the tier name beside it.
 */
function Step({
  statKey,
  tier,
  step,
  onStep
}: {
  statKey: StatKey
  tier: StatTier
  /** -1 lowers the stat, +1 raises it. */
  step: -1 | 1
  onStep: (key: StatKey, delta: 1 | -1) => void
}): JSX.Element {
  const dead = step < 0 ? tier <= MIN_TIER : tier >= MAX_TIER
  return (
    <motion.button
      className="vu-square vu-square--step"
      type="button"
      disabled={dead}
      aria-label={`${step < 0 ? 'Lower' : 'Raise'} ${STAT_LABELS[statKey]}`}
      {...gestures(dead, quietLift, quietPress)}
      onClick={() => onStep(statKey, step)}
    >
      {step < 0 ? '−' : '+'}
    </motion.button>
  )
}
