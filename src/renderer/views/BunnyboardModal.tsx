import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type JSX,
  type ReactNode,
  type SetStateAction
} from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  fullNameOf,
  type Character,
  type CharInfo,
  type ChatMessage,
  type Conversation,
  type TimeSlot
} from '@shared/types'
import type { NpcFriendship } from '@shared/npcRelationships'
import { gpaOf, gradedCourses } from '@shared/academics'
import { globalSlotOf, jobDefForChat, shiftSlotOf } from '@shared/jobs'
import { locationLabel, ROOM_LOCATION } from '@shared/locations'
import { formatMoney } from '@shared/money'
import { PROFILE_PICTURE_TYPES } from '@shared/profilePicture'
import { formatTokens } from '@shared/tallies'
import { affectionFor, emptyFlags, relationshipTagOf } from '@shared/relationship'
import { ConfirmModal } from '../components/ConfirmModal'
import { TextField } from '../components/TextField'
import { useModalShell } from '../components/useModalShell'
import { yearLabel } from '@shared/classes'
import {
  formatChatDivider,
  formatNumericGameDate,
  formatShortGameDate,
  shiftWeekdayOf,
  slotHalf
} from '../prompts/gameDate'
import { handedBackAcedCount } from '../prompts/classProgress'
import { ADD_DROP_DATE } from '../prompts/occasions'
import { profileDescriptionOf } from '../prompts/setting'
import { isVenusChat, VENUS_EMOJI, VENUS_NAME, VENUS_TITLE } from '../prompts/venus'
import { isBunnybotChat, BUNNYBOT_EMOJI, BUNNYBOT_NAME, BUNNYBOT_TITLE } from '../prompts/bunnybot'
import { useBunnyboardStore, type BunnyboardTab } from '../stores/bunnyboardStore'
import { profileUrl, useSpriteVersion } from '../stores/characterStore'
import { postsLocationUpdate } from '../stores/feedRolls'
import { FEED_PAGE, isFeedContact, updatesFeed, type FeedEntry } from '../stores/feedView'
import { knownWhereabouts, type Whereabouts } from '../stores/whereabouts'
import { useGameStore } from '../stores/gameStore'
import { pickProfilePicture, removeProfilePicture } from '../stores/loop/profilePicture'
import { useSettingsStore } from '../stores/settingsStore'
import {
  acceptFriendRequest,
  answerHangout,
  beginHangout,
  blockedThreadHidden,
  dismissFailedMessage,
  epilogueOf,
  plannedWith,
  replyFromBoss,
  retryFailedMessage,
  sceneActiveOf,
  sendBossMessage,
  sendFriendRequest,
  sendMessage
} from '../stores/textingLoop'
import {
  charBusyNow,
  charHiddenLocationNow,
  charJobNow,
  playerClassNow,
  shiftNow
} from '../stores/timetable'
import { ContactPage } from './ContactPage'
import { RescheduleModal } from './RescheduleModal'
import {
  cancelLift,
  cardSwell,
  dealt,
  dealtItem,
  earBreath,
  earBreathLate,
  gestures,
  lift,
  panelIn,
  portraitLift,
  press,
  quietLift,
  quietPress,
  rowLift,
  rowPress,
  slideInQuick,
  toggleLift,
  typingDot,
  veilIn
} from './motion'
import { BackIcon, BunnyMark, CloseIcon, HeartIcon, MapIcon, PlusIcon } from './screenIcons'
import { LettersFilter, lettersUrl } from '../components/LettersMark'
import '../vu_styles/Bunnyboard.css'

export interface BunnyboardModalProps {
  onClose: () => void
  /** Handed down to the modals this one opens — a portal inherits no palette. */
  theme: 'day' | 'night'
  /** Whether the player holds the turn firmly enough to rearrange a semester. */
  scheduleChangeReady: boolean
  /** Opens the timetable modal; the view owning the panel supplies it. */
  onChangeSchedule: () => void
  /** Opens the part-time jobs modal, whichever face it is owed; likewise supplied. */
  onOpenJobs: () => void
}

/** The two app bots draw a mark where a person has a face; an employer keeps his emoji. */
type BotMark = 'venus' | 'bunny'

/** Who a conversation key belongs to, as its card and its thread header show it. */
interface ChatIdentity {
  /** True for the three catalog bots, which have a mark or an emoji where a sprite would be. */
  bot: boolean
  /** The university's own letters, or the app's own bunny; null for an employer. */
  mark: BotMark | null
  emoji: string | null
  name: string
  /** The bots' one-line role, shown under the name in a thread header. */
  subtitle: string | null
  /** False for a key that resolves to nobody — a character deleted mid-save. */
  known: boolean
}

/** Resolves a conversation key to the identity behind it. */
function chatIdentityOf(charId: string, character: Character | undefined): ChatIdentity {
  const boss = jobDefForChat(charId)
  if (boss) {
    // The person, never the workplace: a thread is with somebody.
    return {
      bot: true,
      mark: null,
      emoji: boss.boss.emoji,
      name: boss.boss.name,
      subtitle: boss.boss.title,
      known: true
    }
  }
  if (isVenusChat(charId)) {
    return {
      bot: true,
      mark: 'venus',
      emoji: VENUS_EMOJI,
      name: VENUS_NAME,
      subtitle: VENUS_TITLE,
      known: true
    }
  }
  if (isBunnybotChat(charId)) {
    return {
      bot: true,
      mark: 'bunny',
      emoji: BUNNYBOT_EMOJI,
      name: BUNNYBOT_NAME,
      subtitle: BUNNYBOT_TITLE,
      known: true
    }
  }
  return {
    bot: false,
    mark: null,
    emoji: null,
    name: character ? fullNameOf(character) : charId,
    subtitle: null,
    known: Boolean(character)
  }
}

/* ---- the rail's four marks ------------------------------------------------- */
/* The rail's own marks: single-screen, so they stay local rather than move to `screenIcons.tsx`. */

const RAIL_MARK = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
} as const

function ChatsIcon(): JSX.Element {
  return (
    <svg {...RAIL_MARK}>
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.6 9.6 0 0 1-3.4-.6L3 21l1.7-5a8.2 8.2 0 0 1-.7-3.4 8.4 8.4 0 0 1 8.5-8.4 8.4 8.4 0 0 1 8.5 8.3Z" />
    </svg>
  )
}

function FriendsIcon(): JSX.Element {
  return (
    <svg {...RAIL_MARK}>
      <path d="M16 21v-1.8a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V21" />
      <circle cx="9" cy="7" r="3.6" />
      <path d="M22 21v-1.8a4 4 0 0 0-3-3.8" />
      <path d="M16 3.3a4 4 0 0 1 0 7.6" />
    </svg>
  )
}

function UpdatesIcon(): JSX.Element {
  return (
    <svg {...RAIL_MARK}>
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5.5" cy="18.5" r="1.4" />
    </svg>
  )
}

function ProfileIcon(): JSX.Element {
  return (
    <svg {...RAIL_MARK}>
      <circle cx="12" cy="7.5" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </svg>
  )
}

/** The four destinations, in rail order. */
const TABS: ReadonlyArray<{ id: BunnyboardTab; word: string; Mark: () => JSX.Element }> = [
  { id: 'chats', word: 'CHATS', Mark: ChatsIcon },
  { id: 'friends', word: 'FRIENDS', Mark: FriendsIcon },
  { id: 'updates', word: 'UPDATES', Mark: UpdatesIcon },
  { id: 'profile', word: 'PROFILE', Mark: ProfileIcon }
]

/** The composer's quick-bar: one tap each, short enough to sit under the field unwrapped. */
const QUICK_EMOJI: readonly string[] = ['😂', '😭', '❤️', '👍', '🍆', '😳', '🔥', '🥺']

/** The rail dealing itself out, and every list in the app's own body. Module scope. */
const RAIL_DEAL = dealt(0.06, 0.05)
const LIST_DEAL = dealt(0, 0.03)

/** The one line the phone says on the goodbye menu, where every thread is read and none written. */
const NOT_NOW = 'Not now.'

/**
 * The Bunnyboard: Chats, Friends and Updates behind one app, and a contact's page over the
 * whole stage. Persisted state lives in `gameStore.bunnyboard`; which screen is showing, in
 * `bunnyboardStore`.
 */
export function BunnyboardModal({
  onClose,
  theme,
  scheduleChangeReady,
  onChangeSchedule,
  onOpenJobs
}: BunnyboardModalProps): JSX.Element | null {
  const tab = useBunnyboardStore((s) => s.tab)
  const viewingCharId = useBunnyboardStore((s) => s.viewingCharId)
  const pageCharId = useBunnyboardStore((s) => s.pageCharId)
  const setTab = useBunnyboardStore((s) => s.setTab)
  const armed = useBunnyboardStore((s) => s.armedHangout)
  const bunnyboard = useGameStore((s) => s.bunnyboard)
  const profilePicture = useGameStore((s) => s.profilePicture)
  const hiddenOf = useHiddenThreads()
  const backToList = useBunnyboardStore((s) => s.backToList)

  // A hidden thread's unread stays off the badge.
  const chatsBadge = Object.values(bunnyboard.conversations).reduce(
    (total, conversation) => (hiddenOf(conversation.charId) ? total : total + conversation.unread),
    0
  )
  const friendsBadge = bunnyboard.contactsBadge

  // Opening the Friends tab is seeing what the badge was about.
  useEffect(() => {
    if (tab === 'friends') useGameStore.getState().clearContactsBadge()
  }, [tab, friendsBadge])

  // The open thread can be hidden under him (a scene starting); the view falls back to the list.
  useEffect(() => {
    if (tab === 'chats' && viewingCharId && hiddenOf(viewingCharId)) backToList()
  }, [tab, viewingCharId, hiddenOf, backToList])

  // An armed hangout stops the overlay closing the app and the rail navigating until Begin.
  const { host, overlayProps } = useModalShell(armed ? () => {} : onClose, 'phone')
  if (!host) return null

  // A contact's page is the whole screen rather than a tab of the app, so the veil gives up
  // its padding for it — the archway she stands in bleeds off two edges of the stage. It is
  // opened from any tab and from any face, which is why it is a field of its own.
  const contact = pageCharId

  return createPortal(
    <motion.div
      className={`vu-veil${contact ? ' vu-veil--bare' : ''}`}
      data-theme={theme}
      variants={veilIn}
      initial="hidden"
      animate="shown"
      exit="gone"
      {...overlayProps}
    >
      {contact ? (
        <ContactPage key={contact} charId={contact} theme={theme} />
      ) : (
        <div className="vu-bb" role="dialog" aria-modal="true" aria-label="Bunnyboard">
          <LettersFilter id="vu-bb-letters" inkClassName="vu-bb-letters-ink" />
          <motion.div className="vu-bb-rail" variants={RAIL_DEAL}>
            <motion.button
              className="vu-circle"
              type="button"
              aria-label="Close Bunnyboard"
              variants={dealtItem}
              disabled={Boolean(armed)}
              {...gestures(Boolean(armed), quietLift, quietPress)}
              onClick={onClose}
            >
              <BackIcon />
            </motion.button>

            {TABS.map((entry) => {
              const on = entry.id === tab
              const badge =
                entry.id === 'chats' ? chatsBadge : entry.id === 'friends' ? friendsBadge : 0
              return (
                <motion.button
                  key={entry.id}
                  id={`bb-tab-${entry.id}`}
                  className={`vu-tile vu-bb-tile vu-paper${on ? ' vu-bb-tile--on' : ''}`}
                  type="button"
                  aria-label={entry.word}
                  aria-pressed={on}
                  variants={dealtItem}
                  disabled={Boolean(armed)}
                  // Its fill is a state, so the hover is a scale and never a tint.
                  {...gestures(Boolean(armed), on ? toggleLift : lift, press)}
                  onClick={() => setTab(entry.id)}
                >
                  {/* His own picture stands where the mark would, once he has one: the seat
                      that is about him is the one place on the rail that shows a face. */}
                  {entry.id === 'profile' && profilePicture ? (
                    <span className="vu-arch vu-bb-tile-face">
                      <span className="vu-crop">
                        <img className="vu-crop-img" src={profilePicture} alt="" />
                      </span>
                    </span>
                  ) : (
                    <entry.Mark />
                  )}
                  <span className="vu-bb-tile-word">{entry.word}</span>
                  {badge > 0 && <span className="vu-tile-badge">{badge}</span>}
                </motion.button>
              )
            })}
          </motion.div>

          {/* The ears are written before the panel, which is the whole of the z-ordering, and
              are its shadow layer continued upward rather than surfaces of their own
              (`Bunnyboard.css`). They breathe on one clock in opposite phase — the idle. */}
          <motion.div className="vu-bb-phone" variants={panelIn}>
            <motion.div className="vu-bb-ear vu-bb-ear--near" animate={earBreath} />
            <motion.div className="vu-bb-ear vu-bb-ear--far" animate={earBreathLate} />

            <div className="vu-bb-panel vu-paper">
              <div className="vu-bb-body">
                {/* The list stands *beside* the thread rather than behind it, which
                    is what takes a back button out of the thread's own header. */}
                {tab === 'chats' && (
                  <>
                    <ChatList />
                    {viewingCharId ? (
                      <ConversationView
                        key={viewingCharId}
                        charId={viewingCharId}
                        theme={theme}
                        scheduleChangeReady={scheduleChangeReady}
                        onChangeSchedule={onChangeSchedule}
                        onOpenJobs={onOpenJobs}
                      />
                    ) : (
                      <ThreadBlank />
                    )}
                  </>
                )}
                {tab === 'friends' && <FriendsList />}
                {tab === 'updates' && <UpdatesFeed />}
                {tab === 'profile' && <ProfilePage />}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>,
    host
  )
}

/**
 * A predicate over charIds: has this thread dropped off the Chats list because she blocked the
 * reader and the slot it happened in is over?
 */
function useHiddenThreads(): (charId: string) => boolean {
  const charInfo = useGameStore((s) => s.charInfo)
  const conversations = useGameStore((s) => s.bunnyboard.conversations)
  const date = useGameStore((s) => s.date)
  const time = useGameStore((s) => s.time)
  const sceneActive = useGameStore(sceneActiveOf)

  return (charId) =>
    blockedThreadHidden(
      conversations[charId],
      charInfo[charId]?.flags?.blocked === true,
      date,
      time,
      sceneActive
    )
}

/** One line of preview text for a chat card. */
function previewOf(conversation: Conversation): string {
  const last = conversation.messages[conversation.messages.length - 1]
  if (!last) return ''
  return last.sender === 'player' ? `You: ${last.text}` : last.text
}

/**
 * A face in a list: an archway holding her profile crop, or a bot's emoji in the same
 * frame so a column of them stays one column. Sized by class rather than by a style prop —
 * four sizes serve every list in the app.
 */
function Portrait({
  charId,
  emoji,
  mark,
  ring,
  size = 'md'
}: {
  charId?: string
  emoji?: string | null
  mark?: BotMark | null
  /** The accent ring a person's face wears in a list — never a bot's, a boss's or a random's. */
  ring?: boolean
  size?: 'sm' | 'md' | 'lg'
}): JSX.Element {
  const version = useSpriteVersion(charId)
  const shape = `vu-arch vu-bb-face vu-bb-face--${size}${ring ? ' vu-bb-face--ring' : ''}`

  if (!charId) {
    return (
      <span className={`${shape} vu-bb-face--bot`}>
        {mark === 'venus' ? (
          <img className="vu-bb-letters" src={lettersUrl} alt="" />
        ) : mark === 'bunny' ? (
          <BunnyMark />
        ) : (
          (emoji ?? '👤')
        )}
      </span>
    )
  }
  return (
    <span className={shape}>
      <span className="vu-crop">
        <img className="vu-crop-img" src={profileUrl(charId, version)} alt="" />
      </span>
    </span>
  )
}

/**
 * A face that opens her page. An archway at this size takes neither a button's tenth nor a
 * card's paper: `portraitLift`'s swell, and a
 * press that only shrinks it — `.vu-bb-face` carries no shadow to slide down onto.
 */
function FaceButton({
  name,
  dead,
  onOpen,
  children
}: {
  name: string
  dead?: boolean
  onOpen: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <motion.button
      className="vu-bb-face-btn"
      type="button"
      aria-label={`Open ${name}`}
      disabled={dead}
      {...gestures(Boolean(dead), portraitLift, rowPress)}
      onClick={onOpen}
    >
      {children}
    </motion.button>
  )
}

/** Where the app is willing to say she is, and whether the hour has a claim on her. */
interface Presence {
  /** A class or a shift has her — what the lamp says. */
  busy: boolean
  /** The one line beside it, which is never empty. */
  text: string
}

/**
 * The status a thread header and a contact card both carry. It reads the **map's** own row,
 * so the phone can never place her somewhere the map would not — and where the map says
 * nothing, the app says only what it does know: she is on it.
 */
function presenceOf(
  placed: Whereabouts | undefined,
  charId: string,
  date: number,
  time: TimeSlot
): Presence {
  if (!placed || placed.source !== 'told' || placed.kind === 'unknown') {
    return { busy: false, text: 'Online' }
  }
  if (placed.kind === 'away') return { busy: false, text: placed.placeLabel }
  if (placed.kind === 'class') {
    // The class's own name, not the code the map files it under: this is a sentence about her.
    const named = placed.classCode ? useGameStore.getState().classes[placed.classCode]?.name : null
    return { busy: true, text: `In class — ${named ?? placed.classCode}` }
  }
  // A shift reads as a place on the map; on a phone it is worth saying it is work.
  if (charJobNow(charId, date, time) !== null) {
    return { busy: true, text: `Working @ ${placed.placeLabel}` }
  }
  return { busy: false, text: `At ${placed.placeLabel}` }
}

/** Whether the hour has a claim on her — a class or a shift, which is what the lamp says. */
function BusyLed({ busy }: { busy: boolean }): JSX.Element {
  return <span className={`vu-bb-led${busy ? ' vu-bb-led--busy' : ''}`} />
}

/** The Chats tab's conversation list, which stands beside the open thread rather than under it. */
function ChatList(): JSX.Element {
  const bunnyboard = useGameStore((s) => s.bunnyboard)
  const characters = useGameStore((s) => s.characters)
  const date = useGameStore((s) => s.date)
  const time = useGameStore((s) => s.time)
  const viewingCharId = useBunnyboardStore((s) => s.viewingCharId)
  const viewChar = useBunnyboardStore((s) => s.viewChar)
  const openPage = useBunnyboardStore((s) => s.openPage)
  const armed = useBunnyboardStore((s) => s.armedHangout)
  const hiddenOf = useHiddenThreads()

  // Newest activity first.
  const conversations = Object.values(bunnyboard.conversations)
    .filter((conversation) => conversation.messages.length > 0)
    .filter((conversation) => !hiddenOf(conversation.charId))
    .sort((a, b) => {
      const lastOf = (c: Conversation): number => {
        const last = c.messages[c.messages.length - 1]
        return last ? globalSlotOf(last.date, last.time) : 0
      }
      return lastOf(b) - lastOf(a)
    })

  return (
    <div className="vu-bb-chats">
      <div className="vu-title vu-bb-title">
        <h2 className="vu-title-text">Chats</h2>
      </div>

      {conversations.length === 0 ? (
        <p className="vu-empty vu-empty--flush">No chats yet. Add some friends to start texting.</p>
      ) : (
        <div className="vu-bb-scroll">
          <motion.ul className="vu-rows" variants={LIST_DEAL}>
            {conversations.map((conversation) => {
              const identity = chatIdentityOf(conversation.charId, characters[conversation.charId])
              if (!identity.known) return null
              const last = conversation.messages[conversation.messages.length - 1]
              const on = conversation.charId === viewingCharId
              return (
                <motion.li key={conversation.charId} variants={slideInQuick}>
                  {/* The card is a row of two controls rather than one: her face opens her page
                      and the rest opens the thread, and a button may never hold a button — the
                      face is its sibling, which is the arrangement rather than a propagation
                      rule. The tint and the press stay the whole row's, and between them
                      the two children cover every pixel of it. */}
                  <motion.div
                    className={`vu-row vu-bb-chat${on ? ' vu-bb-chat--on' : ''}`}
                    // Nothing navigates while a hangout is armed.
                    {...gestures(Boolean(armed), rowLift, rowPress)}
                  >
                    {!identity.bot && (
                      <FaceButton
                        name={identity.name}
                        dead={Boolean(armed)}
                        onOpen={() => openPage(conversation.charId)}
                      >
                        <Portrait charId={conversation.charId} ring />
                      </FaceButton>
                    )}
                    {/* **The two controls divide the card up rather than sitting inside its own
                        padding**: a click on the inset tinted and pressed the row and then opened
                        nothing, which is a card answering a click it does not honour. A bot
                        has no page, so its face is drawn inside this target rather than beside
                        it — a `Portrait` is a span, so no button holds a button either way. */}
                    <button
                      className={`vu-bb-chat-hit${identity.bot ? ' vu-bb-chat-hit--whole' : ''}`}
                      type="button"
                      disabled={Boolean(armed)}
                      onClick={() => viewChar(conversation.charId)}
                    >
                      {identity.bot && <Portrait emoji={identity.emoji} mark={identity.mark} />}
                      <span className="vu-bb-chat-main">
                        <span className="vu-bb-chat-top">
                          <span className="vu-bb-name">{identity.name}</span>
                          {identity.bot && (
                            <span className="vu-bb-kind">
                              {jobDefForChat(conversation.charId) ? 'BOSS' : 'BOT'}
                            </span>
                          )}
                        </span>
                        <span className="vu-bb-preview">{previewOf(conversation)}</span>
                      </span>
                      {conversation.unread > 0 ? (
                        <span className="vu-bb-unread">{conversation.unread}</span>
                      ) : (
                        // The date it last spoke, or that it is speaking in this very slot —
                        // a half of the day says nothing a list sorted by recency has not.
                        last && (
                          <span className="vu-bb-stamp">
                            {last.date === date && last.time === time
                              ? 'NOW'
                              : formatNumericGameDate(last.date)}
                          </span>
                        )
                      )}
                    </button>
                  </motion.div>
                </motion.li>
              )
            })}
          </motion.ul>
        </div>
      )}
    </div>
  )
}

/** The thread column with nothing open in it. */
function ThreadBlank(): JSX.Element {
  return (
    <div className="vu-bb-thread vu-bb-thread--blank">
      <p className="vu-empty vu-empty--flush">Pick a conversation on the left to view it.</p>
    </div>
  )
}

/** A boss thread's composer: buttons, never a text box. */
function BossActions({
  jobId,
  theme,
  ready,
  onOpenJobs
}: {
  jobId: string
  theme: 'day' | 'night'
  ready: boolean
  onOpenJobs: () => void
}): JSX.Element {
  const job = useGameStore((s) => s.job)
  const date = useGameStore((s) => s.date)
  const time = useGameStore((s) => s.time)
  const sceneActive = useGameStore(sceneActiveOf)
  const epilogue = useGameStore(epilogueOf)
  const [quitting, setQuitting] = useState(false)

  // Only the *current* job's thread is live; a thread from a job he was fired
  // from stays readable and does nothing.
  const live = job?.jobId === jobId ? job : null
  const slotId = globalSlotOf(date, time)
  const onShift = Boolean(live && live.shifts.includes(shiftSlotOf(shiftWeekdayOf(date), time)))
  const canCallIn = Boolean(
    live && onShift && live.excusedSlot !== slotId && live.sickTextedSlot !== slotId
  )

  function callInSick(): void {
    if (!live || !canCallIn) return
    sendBossMessage(jobId, "I'm sick.")
    // One call-in per shift, believed or not: the slot is recorded on every send.
    // Only the first is believed and excuses the shift; the save is written on the click.
    if (live.sickUsed) {
      useGameStore.getState().updateJob({ sickTextedSlot: slotId })
      void replyFromBoss(jobId, 'sick2')
    } else {
      useGameStore
        .getState()
        .updateJob({ sickUsed: true, excusedSlot: slotId, sickTextedSlot: slotId })
      void replyFromBoss(jobId, 'sick1')
    }
  }

  function quit(): void {
    setQuitting(false)
    sendBossMessage(jobId, 'I need to quit the job.')
    void replyFromBoss(jobId, 'quit')
    // The job ends on the click, not on his answer.
    useGameStore.getState().endJob()
  }

  // A scene takes the buttons off, exactly as it does the ordinary composer, and the goodbye
  // menu takes them off for good.
  if (sceneActive) return <BotBusyRow text="You should probably focus right now." />
  if (epilogue) return <BotBusyRow text={NOT_NOW} />

  return (
    <div className="vu-bb-answers">
      <div className="vu-bb-answers-row">
        <PrimaryButton id="bb-boss-sick" dead={!canCallIn} onClick={callInSick}>
          I&apos;m sick
        </PrimaryButton>
        <PrimaryButton id="bb-boss-quit" dead={!live} onClick={() => setQuitting(true)}>
          Quit job
        </PrimaryButton>
        {/* Both open the same hired view. Dead once the job is over, like the two above. */}
        <PrimaryButton id="bb-boss-details" dead={!live || !ready} onClick={onOpenJobs}>
          Job details
        </PrimaryButton>
        <PrimaryButton id="bb-boss-shift" dead={!live || !ready} onClick={onOpenJobs}>
          Request shift change
        </PrimaryButton>
      </div>

      <AnimatePresence propagate>
        {quitting && (
          <ConfirmModal
            key="quit-job"
            id="bb-boss-quit-confirm"
            theme={theme}
            title="Quit your job?"
            message="You won't be able to apply here again for the rest of the semester."
            confirmText="Quit"
            cancelText="Never mind"
            onConfirm={quit}
            onCancel={() => setQuitting(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/** A bot's button row with the buttons off: the one line the thread has to say instead. */
function BotBusyRow({ text }: { text: string }): JSX.Element {
  return (
    <div className="vu-bb-answers">
      <span className="vu-bb-answers-text">{text}</span>
    </div>
  )
}

/** VenusBot's composer: buttons, never a text box. */
function VenusActions({
  ready,
  onChangeSchedule,
  onOpenJobs
}: {
  ready: boolean
  onChangeSchedule: () => void
  onOpenJobs: () => void
}): JSX.Element {
  const date = useGameStore((s) => s.date)
  const job = useGameStore((s) => s.job)
  const jobIntroSent = useGameStore((s) => s.venusJobIntroSent)
  const sceneActive = useGameStore(sceneActiveOf)
  const epilogue = useGameStore(epilogueOf)

  if (sceneActive) return <BotBusyRow text="You should probably focus right now." />
  if (epilogue) return <BotBusyRow text={NOT_NOW} />

  // Inclusive: the deadline day itself is still open, as the day's own reminder says.
  const open = date <= ADD_DROP_DATE

  return (
    <div className="vu-bb-answers">
      {!open && <span className="vu-bb-answers-text">The add/drop period has ended.</span>}
      <div className="vu-bb-answers-row">
        <PrimaryButton id="bb-venus-schedule" dead={!open || !ready} onClick={onChangeSchedule}>
          Change schedule
        </PrimaryButton>
        {jobIntroSent && (
          <PrimaryButton id="bb-venus-jobs" dead={job !== null || !ready} onClick={onOpenJobs}>
            Apply for a part-time job
          </PrimaryButton>
        )}
      </div>
    </div>
  )
}

/**
 * The card's back-out control, recessed as bare words rather than a modal's dim pill, tinted
 * with {@link quietLift}'s own step. Disabled, it is handed no gesture.
 */
function CancelButton({
  id,
  dead,
  onClick,
  children
}: {
  id: string
  dead?: boolean
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <motion.button
      id={id}
      className="vu-btn vu-btn--quiet vu-bb-btn--cancel"
      type="button"
      disabled={dead}
      {...gestures(Boolean(dead), cancelLift, quietPress)}
      onClick={onClick}
    >
      {children}
    </motion.button>
  )
}

/** The loud answer in a footer — one to a row, as a screen has one primary. */
function PrimaryButton({
  id,
  dead,
  className,
  onClick,
  children
}: {
  id: string
  dead?: boolean
  className?: string
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <motion.button
      id={id}
      className={`vu-btn vu-btn--primary vu-btn--panel vu-paper${className ? ` ${className}` : ''}`}
      type="button"
      disabled={dead}
      {...gestures(Boolean(dead), lift, press)}
      onClick={onClick}
    >
      {children}
    </motion.button>
  )
}

/** One open conversation: history, and the input or its stand-ins. */
function ConversationView({
  charId,
  theme,
  scheduleChangeReady,
  onChangeSchedule,
  onOpenJobs
}: {
  charId: string
  theme: 'day' | 'night'
  scheduleChangeReady: boolean
  onChangeSchedule: () => void
  onOpenJobs: () => void
}): JSX.Element {
  const conversation = useGameStore((s) => s.bunnyboard.conversations[charId])
  const character = useGameStore((s) => s.characters[charId])
  const info = useGameStore((s) => s.charInfo[charId])
  const date = useGameStore((s) => s.date)
  const time = useGameStore((s) => s.time)
  // A subscribed read, so the footer redraws the moment a rescheduled plan leaves this slot.
  const events = useGameStore((s) => s.events)
  const armed = useBunnyboardStore((s) => s.armedHangout)
  const openPage = useBunnyboardStore((s) => s.openPage)
  const sceneActive = useGameStore(sceneActiveOf)
  const epilogue = useGameStore(epilogueOf)
  const [draft, setDraft] = useState('')
  const [scrollBox, setScrollBox] = useState<HTMLDivElement | null>(null)

  const messages = conversation?.messages ?? []
  const identity = chatIdentityOf(charId, character)
  const boss = jobDefForChat(charId)
  const bot = identity.bot
  const name = character?.firstName ?? '???'
  // No bot has a timetable.
  const atWork = !bot && charJobNow(charId) !== null
  const unavailable = !bot && charBusyNow(charId)
  // Her reply plus the hangout classifier that reads it.
  const busy = useBunnyboardStore((s) => s.busyCharIds.includes(charId))
  // Texts written and waiting out their typing delay.
  const typing = useBunnyboardStore((s) => s.typingCharIds.includes(charId))
  // Her last turn failed and is parked on Retry.
  const failed = useBunnyboardStore((s) => s.failedCharIds.includes(charId))
  // Her ask-out, only while it is still asking: a No dismisses it, invitation still standing.
  const pendingHangout = conversation?.pendingHangout
  const askingOut = Boolean(pendingHangout && !pendingHangout.dismissed)
  const armedHere = armed?.charId === charId
  // Reschedule needs a real `CalendarEvent` to move and an hour already spoken for.
  const plan = bot ? null : plannedWith(charId, date, time, events)
  const canReschedule =
    askingOut && plan !== null && (playerClassNow() !== null || shiftNow() !== null)
  const [rescheduling, setRescheduling] = useState(false)
  // She has him blocked: readable to the end of the slot, nothing sendable.
  const blocked = useGameStore((s) => s.charInfo[charId]?.flags?.blocked === true)

  // Opening the thread, and any message landing while it is open, is reading it.
  useEffect(() => {
    useGameStore.getState().markConversationRead(charId)
  }, [charId, messages.length])

  // Sticks to the newest message. State, not a ref: the portal host is attached late.
  useEffect(() => {
    if (scrollBox) scrollBox.scrollTop = scrollBox.scrollHeight
  }, [scrollBox, messages.length, typing])

  // The well growing under the list shortens it, which would hide the newest bubble: a list
  // that was at its foot before the resize is put back there, and one scrolled up is left alone.
  useEffect(() => {
    if (!scrollBox || typeof ResizeObserver === 'undefined') return
    let seen = scrollBox.clientHeight
    const observer = new ResizeObserver(() => {
      const atFoot = scrollBox.scrollHeight - seen - scrollBox.scrollTop <= 2
      seen = scrollBox.clientHeight
      if (atFoot) scrollBox.scrollTop = scrollBox.scrollHeight
    })
    observer.observe(scrollBox)
    return () => observer.disconnect()
  }, [scrollBox])

  // The reasons the composer is shut, shared by the field, Send and the emoji bar.
  const composerClosed = epilogue || sceneActive || unavailable || busy || blocked

  function onSend(): void {
    const value = draft.trim()
    if (!value || composerClosed) return
    setDraft('')
    void sendMessage(charId, value)
  }

  // Her handle sits beside her name, and under the pair a lamp and the one line the app is
  // willing to say about her hour — never a relationship tag, which belongs on the page
  // that is about her.
  const handle = bot ? null : info?.handle
  const placed = bot ? undefined : knownWhereabouts(date, time).find((row) => row.charId === charId)
  // A blocked thread says nothing about where she is: the map has dropped her to what he
  // remembers, and the composer under it already says she blocked him. Neither does a screen
  // set sometime after graduation, which pins nobody to an hour.
  const status = bot || blocked || epilogue ? null : presenceOf(placed, charId, date, time)

  return (
    <div className="vu-bb-thread">
      <div className="vu-bb-thread-head">
        {bot ? (
          <Portrait emoji={identity.emoji} mark={identity.mark} />
        ) : (
          <FaceButton name={identity.name} dead={Boolean(armed)} onOpen={() => openPage(charId)}>
            <Portrait charId={charId} ring />
          </FaceButton>
        )}
        <span className="vu-bb-thread-who">
          <span className="vu-bb-chat-top">
            <span className="vu-bb-thread-name">{identity.name}</span>
            {handle && <span className="vu-bb-handle">@{handle}</span>}
          </span>
          {(identity.subtitle || status) && (
            <span className="vu-bb-thread-sub">
              {identity.subtitle}
              {status && (
                <>
                  <BusyLed busy={status.busy} />
                  {status.text}
                </>
              )}
            </span>
          )}
        </span>
      </div>

      <div className="vu-bb-msgs" ref={setScrollBox}>
        {messages.map((message, index) => {
          // A divider opens the thread and repeats whenever the slot changes.
          const previous = messages[index - 1]
          const stamp = formatChatDivider(message.date, message.time)
          const divider = !previous || formatChatDivider(previous.date, previous.time) !== stamp
          return (
            <Fragment key={message.id}>
              {divider && (
                // The same two readings `formatChatDivider` is built from, glued differently:
                // that function stays the one thing deciding where a divider goes.
                <div className="vu-bb-divider">
                  <span>{formatShortGameDate(message.date)}</span>
                  <span className="vu-bb-thread-dot">·</span>
                  <span>{slotHalf(message.time)}</span>
                </div>
              )}
              <MessageBubble message={message} />
            </Fragment>
          )
        })}
        {typing && (
          <div
            className="vu-bb-bubble vu-bb-bubble--theirs vu-bb-bubble--typing"
            aria-label="typing"
          >
            {typingDot.map((beat, index) => (
              <motion.span key={index} className="vu-bb-dot" animate={beat} />
            ))}
          </div>
        )}
      </div>

      <div className="vu-bb-foot">
        {boss ? (
          <BossActions
            jobId={boss.id}
            theme={theme}
            ready={scheduleChangeReady}
            onOpenJobs={onOpenJobs}
          />
        ) : isVenusChat(charId) ? (
          <VenusActions
            ready={scheduleChangeReady}
            onChangeSchedule={onChangeSchedule}
            onOpenJobs={onOpenJobs}
          />
        ) : bot ? (
          // BunnyBot's thread is read and closed: any other bot is silent by default.
          null
        ) : // The goodbye menu's phone answers nothing and starts nothing: every thread under it
        // falls through to the shut composer, whatever it was in the middle of.
        !epilogue && armedHere ? (
          // Click-only: Enter would start the scene under a player still reading.
          <PrimaryButton
            id="bb-begin-hangout"
            className="vu-bb-begin"
            onClick={() => void beginHangout()}
          >
            Begin hangout
          </PrimaryButton>
        ) : !epilogue && failed ? (
          <div className="vu-bb-answers">
            <span className="vu-bb-answers-text">
              Failed to receive {name}&apos;s message.
            </span>
            <div className="vu-bb-answers-row">
              <CancelButton id="bb-retry-dismiss" onClick={() => dismissFailedMessage(charId)}>
                Dismiss
              </CancelButton>
              <PrimaryButton
                id="bb-retry"
                // Retrying is sending; the composer's own reasons to be shut apply.
                dead={sceneActive || unavailable || blocked}
                onClick={() => void retryFailedMessage(charId)}
              >
                Retry
              </PrimaryButton>
            </div>
          </div>
        ) : !epilogue && askingOut ? (
          <div className="vu-bb-answers">
            <span className="vu-bb-answers-text">{name} wants to hang out. Are you down?</span>
            <div className="vu-bb-answers-row">
              <CancelButton
                id="bb-hangout-no"
                dead={sceneActive}
                onClick={() => answerHangout(charId, false)}
              >
                No
              </CancelButton>
              {canReschedule && (
                <motion.button
                  id="bb-hangout-reschedule"
                  className="vu-btn vu-btn--outline vu-btn--panel vu-paper vu-bb-btn--warn"
                  type="button"
                  disabled={sceneActive}
                  {...gestures(sceneActive, lift, press)}
                  onClick={() => setRescheduling(true)}
                >
                  Reschedule
                </motion.button>
              )}
              <PrimaryButton
                id="bb-hangout-yes"
                dead={sceneActive}
                onClick={() => answerHangout(charId, true)}
              >
                Yes
              </PrimaryButton>
            </div>
          </div>
        ) : (
          <Composer
            closed={composerClosed}
            draft={draft}
            placeholder={
              // The goodbye menu outranks every reason below it: whatever she is doing or has
              // done, this is not the hour for it.
              epilogue
                ? NOT_NOW
                : sceneActive
                  ? "You should probably focus on what's in front of you."
                  : // Blocked outranks the other two.
                    blocked
                    ? `${name} blocked you.`
                    : unavailable
                      ? `${name} is ${atWork ? 'at work' : 'in class'} right now.`
                      : busy
                        ? `Waiting for ${name}...`
                        : 'Message'
            }
            onDraft={setDraft}
            onSend={onSend}
          />
        )}
      </div>

      {/* A sibling of the app's own veil, so a click in it does not reach that veil's handler. */}
      <AnimatePresence propagate>
        {rescheduling && plan && (
          <RescheduleModal
            key="reschedule"
            event={plan}
            charId={charId}
            theme={theme}
            onClose={() => setRescheduling(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * The field, its answer and the quick-bar under them. The well opens on a round cap where the
 * words start and runs flat into Send, which faces back at it across the row — the scene's own
 * arrangement. Everything here is shut together, for the four reasons the thread decides.
 */
function Composer({
  closed,
  draft,
  placeholder,
  onDraft,
  onSend
}: {
  closed: boolean
  draft: string
  placeholder: string
  /** The setter itself, so an emoji appends to whatever is in the field at the click. */
  onDraft: Dispatch<SetStateAction<string>>
  onSend: () => void
}): JSX.Element {
  return (
    <div
      className="vu-bb-composer"
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return
        // Keep the window-level Enter handler from advancing the scene, on the field and the
        // emoji buttons alike; the field itself sends on Enter and breaks a line on Shift+Enter.
        e.stopPropagation()
        if ((e.target as HTMLElement).id !== 'bb-compose' || e.shiftKey) return
        e.preventDefault()
        onSend()
      }}
    >
      <div className="vu-bb-compose">
        <textarea
          id="bb-compose"
          rows={1}
          className="vu-input vu-bb-input vu-bb-input--multiline"
          value={draft}
          disabled={closed}
          placeholder={placeholder}
          onChange={(e) => onDraft(e.target.value)}
        />
        <PrimaryButton id="bb-send" dead={closed || !draft.trim()} onClick={onSend}>
          Send
        </PrimaryButton>
      </div>

      <div className="vu-bb-emoji">
        {QUICK_EMOJI.map((emoji) => (
          <motion.button
            key={emoji}
            type="button"
            className="vu-bb-emoji-btn"
            aria-label={`Add ${emoji}`}
            disabled={closed}
            {...gestures(closed, quietLift, quietPress)}
            // Appended to the end of the draft, which has no selection to insert into.
            onClick={() => onDraft((current) => current + emoji)}
          >
            {emoji}
          </motion.button>
        ))}
      </div>
    </div>
  )
}

/** One message bubble: the player's, the contact's, or a system line. */
function MessageBubble({ message }: { message: ChatMessage }): JSX.Element {
  if (message.sender === 'system') {
    return (
      <div
        className={`vu-bb-bubble vu-bb-bubble--system${message.error ? ' vu-bb-bubble--error' : ''}`}
      >
        {message.text}
      </div>
    )
  }
  return (
    <div className={`vu-bb-bubble vu-bb-bubble--${message.sender === 'player' ? 'mine' : 'theirs'}`}>
      {message.text}
    </div>
  )
}

/** The Friends tab: what expires on top, then who he could ask, then who he has. */
function FriendsList(): JSX.Element {
  const bunnyboard = useGameStore((s) => s.bunnyboard)
  const characters = useGameStore((s) => s.characters)
  const charInfo = useGameStore((s) => s.charInfo)
  const chars = useGameStore((s) => s.chars)
  const date = useGameStore((s) => s.date)
  const time = useGameStore((s) => s.time)
  const epilogue = useGameStore(epilogueOf)
  const openPage = useBunnyboardStore((s) => s.openPage)

  // Every card's status off one reading of the map, rather than one walk of the roster apiece.
  // None on the goodbye menu, which pins nobody to an hour.
  const placed = new Map(
    epilogue ? [] : knownWhereabouts(date, time).map((row) => [row.charId, row] as const)
  )

  // A blocked contact is off the list while the block stands. Closest first; a tie keeps
  // roster order.
  const contacts = chars
    .filter(
      (charId) => charInfo[charId]?.flags?.gaveContactInfo && !charInfo[charId]?.flags?.blocked
    )
    .map((charId) => ({
      charId,
      affection: affectionFor(charInfo[charId], date, characters[charId])
    }))
    .sort((a, b) => b.affection - a.affection)
  // The three the boundary drew, minus anyone who became a contact since; absent until
  // the first draw.
  const offered = (bunnyboard.suggestions ?? []).filter(
    (charId) => characters[charId] && !charInfo[charId]?.flags?.gaveContactInfo
  )
  // Incoming requests are outside that cap, and they are the thing that expires.
  const incoming = bunnyboard.requestsReceived.filter(
    (charId) => characters[charId] && !charInfo[charId]?.flags?.gaveContactInfo
  )
  const discover = offered.filter((charId) => !incoming.includes(charId))

  return (
    <div className="vu-bb-page">
      <div className="vu-title vu-bb-title">
        <h2 className="vu-title-text">Friends</h2>
      </div>

      <div className="vu-bb-scroll">
        {incoming.length > 0 && (
          <>
            <div className="vu-bb-section">Requests · {incoming.length}</div>
            <motion.div className="vu-bb-rows" variants={LIST_DEAL}>
              {incoming.map((charId) => {
                const character = characters[charId]
                if (!character) return null
                return (
                  // Flat on the LEFT: this row is an action item, where every other row on the
                  // tab is a surface flat on the right.
                  <motion.div key={charId} className="vu-bb-request" variants={slideInQuick}>
                    <Portrait charId={charId} size="lg" />
                    <span className="vu-bb-request-main">
                      <span className="vu-bb-chat-top">
                        <span className="vu-bb-name">{fullNameOf(character)}</span>
                        {charInfo[charId]?.handle && (
                          <span className="vu-bb-handle">@{charInfo[charId]?.handle}</span>
                        )}
                      </span>
                      <span className="vu-bb-request-line">wants to be friends</span>
                    </span>
                    <PrimaryButton
                      id={`bb-accept-${charId}`}
                      onClick={() => acceptFriendRequest(charId)}
                    >
                      Accept
                    </PrimaryButton>
                  </motion.div>
                )
              })}
            </motion.div>
          </>
        )}

        {discover.length > 0 && (
          <>
            <div className="vu-bb-section">Discover people</div>
            <motion.div className="vu-bb-discover" variants={LIST_DEAL}>
              {discover.map((charId) => (
                <SuggestCard
                  key={charId}
                  charId={charId}
                  character={characters[charId]}
                  handle={charInfo[charId]?.handle}
                  requested={bunnyboard.requestsSent.includes(charId)}
                  onOpen={() => openPage(charId)}
                />
              ))}
            </motion.div>
          </>
        )}

        <div className="vu-bb-section">Contacts · {contacts.length}</div>
        {contacts.length === 0 ? (
          <p className="vu-empty vu-empty--flush">No friends yet. Try adding people you know.</p>
        ) : (
          // Two across, in the suggestion card's own shape: a contact is worth a card rather
          // than a line, and the second column is what pays for the four readings on it.
          <motion.div className="vu-bb-contacts" variants={LIST_DEAL}>
            {contacts.map(({ charId, affection }) => {
              const character = characters[charId]
              const info = charInfo[charId]
              if (!character || !info) return null
              return (
                <ContactCard
                  key={charId}
                  charId={charId}
                  character={character}
                  info={info}
                  tag={relationshipTagOf(info.flags ?? emptyFlags(), affection)}
                  status={presenceOf(placed.get(charId), charId, date, time)}
                  onOpen={() => openPage(charId)}
                />
              )
            })}
          </motion.div>
        )}
      </div>
    </div>
  )
}

/**
 * The Profile tab: his own card at the head of the app everybody else is listed in, the bio that
 * rides every prompt, and the semester counted up. Every reading below the bio is derived here
 * from what the save already holds rather than kept beside it.
 */
function ProfilePage(): JSX.Element {
  const firstName = useGameStore((s) => s.playerFirstName)
  const lastName = useGameStore((s) => s.playerLastName)
  const picture = useGameStore((s) => s.profilePicture)
  const bio = useGameStore((s) => s.bio)
  const setBio = useGameStore((s) => s.setBio)
  const description = useGameStore((s) => profileDescriptionOf(s))
  const counts = useGameStore((s) => s.tallies)
  const classRecords = useGameStore((s) => s.classRecords)
  const classes = useGameStore((s) => s.classes)
  const playerSchedule = useGameStore((s) => s.playerSchedule)
  const occasions = useGameStore((s) => s.occasions)
  const date = useGameStore((s) => s.date)
  const finalsScoresShown = useGameStore((s) => s.finalsScoresShown)
  const chars = useGameStore((s) => s.chars)
  const charInfo = useGameStore((s) => s.charInfo)
  const conversations = useGameStore((s) => s.bunnyboard.conversations)
  const lessNsfwText = useSettingsStore((s) => s.settings?.lessNsfwText === true)
  const fileInput = useRef<HTMLInputElement>(null)

  /** Hands the pick to the store, clearing the box so the same file picked twice fires twice. */
  const pick = (file: File | undefined): void => {
    if (fileInput.current) fileInput.current.value = ''
    if (!file) return
    void pickProfilePicture(file)
  }

  // One walk of the roster, the records and the threads for the whole grid, rather than one
  // apiece: every tile below is a count of something the save is already keeping.
  const readings = useMemo(() => {
    let attended = 0
    let recorded = 0
    for (const record of Object.values(classRecords)) {
      for (const meeting of record.meetings) {
        recorded += 1
        if (meeting.attended) attended += 1
      }
    }
    const met = chars.filter((charId) => charInfo[charId]?.flags?.hasMet).length
    const contacts = chars.filter(
      (charId) => charInfo[charId]?.flags?.gaveContactInfo && !charInfo[charId]?.flags?.blocked
    ).length
    const gifts = chars.reduce((total, charId) => total + (charInfo[charId]?.gifts ?? []).length, 0)
    const texts = Object.values(conversations).reduce(
      (total, conversation) =>
        total + conversation.messages.filter((message) => message.sender === 'player').length,
      0
    )
    return [
      { id: 'bb-tally-girls', label: 'GIRLS MET', value: `${met} / ${chars.length}` },
      {
        id: 'bb-tally-gpa',
        label: 'GPA',
        value: gpaOf(classRecords, gradedCourses(playerSchedule, classes)).toFixed(2)
      },
      { id: 'bb-tally-money', label: 'MONEY EARNED', value: formatMoney(counts.moneyEarned) },
      { id: 'bb-tally-contacts', label: 'CONTACTS', value: String(contacts) },
      { id: 'bb-tally-kisses', label: 'KISSES', value: String(counts.kisses) },
      { id: 'bb-tally-classes', label: 'CLASSES ATTENDED', value: `${attended} / ${recorded}` },
      { id: 'bb-tally-gifts', label: 'GIFTS GIVEN', value: String(gifts) },
      { id: 'bb-tally-texts', label: 'TEXTS SENT', value: String(texts) },
      // A player who asked for less of it keeps the tile: the reading under it answers the
      // label's other question instead of counting.
      { id: 'bb-tally-sex', label: 'SEX', value: lessNsfwText ? 'MALE' : String(counts.sex) },
      {
        id: 'bb-tally-exams',
        label: 'EXAMS ACED',
        value: String(handedBackAcedCount(classRecords, classes, occasions, date, finalsScoresShown))
      },
      { id: 'bb-tally-shifts', label: 'SHIFTS WORKED', value: String(counts.shiftsWorked) },
      {
        id: 'bb-tally-tokens',
        label: 'TOKENS GENERATED',
        value: formatTokens(counts.tokensGenerated)
      }
    ]
  }, [
    charInfo,
    chars,
    classRecords,
    classes,
    conversations,
    counts,
    date,
    finalsScoresShown,
    lessNsfwText,
    occasions,
    playerSchedule
  ])

  return (
    <div className="vu-bb-page">
      <div className="vu-title vu-bb-title">
        <h2 className="vu-title-text">Profile</h2>
      </div>

      <div className="vu-bb-scroll">
        <div className="vu-bb-me">
          {/* The archway is the upload control: the one place in the app a face is his own, and
              the ✕ that clears it is its sibling, never a button inside a button. */}
          <motion.button
            className={`vu-arch vu-bb-me-arch${picture ? '' : ' vu-bb-me-arch--empty'}`}
            type="button"
            aria-label={picture ? 'Change profile picture' : 'Add a profile picture'}
            {...gestures(false, portraitLift, quietPress)}
            onClick={() => fileInput.current?.click()}
          >
            {picture ? (
              <span className="vu-crop">
                <img className="vu-crop-img" src={picture} alt="" />
              </span>
            ) : (
              <PlusIcon size={34} />
            )}
          </motion.button>
          {picture && (
            <motion.button
              className="vu-x"
              type="button"
              aria-label="Remove profile picture"
              {...gestures(false, quietLift, quietPress)}
              onClick={() => void removeProfilePicture()}
            >
              <CloseIcon />
            </motion.button>
          )}
          <input
            ref={fileInput}
            id="bb-profile-picture-input"
            type="file"
            accept={PROFILE_PICTURE_TYPES.join(',')}
            hidden
            onChange={(event) => pick(event.target.files?.[0])}
          />
          <div className="vu-bb-me-main">
            <span className="vu-bb-me-name">
              {firstName} {lastName}
            </span>
            <p className="vu-bb-me-line">{description}</p>
          </div>
        </div>

        {/* Enter breaks a line here, so it is kept off the window-level handler that would
            otherwise advance the scene under the phone; the newline itself is the field's. */}
        <div
          className="vu-bb-me-bio"
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.stopPropagation()
          }}
        >
          <TextField
            id="bb-bio"
            label="Bio"
            value={bio}
            onChange={(value) => setBio(value)}
            multiline
            rows={3}
            placeholder="Optional. Can be left blank."
            hint="This is put in every prompt so try to keep it short and sweet. Use third-person past tense and continue this paragraph: The reader is a freshman named <Name>, a male who has a single dorm in Lowrise 4. The reader is <description based on current stats>. The reader is..."
          />
        </div>

        <div className="vu-bb-section">Stats</div>
        <motion.div className="vu-bb-tallies" variants={LIST_DEAL}>
          {readings.map((reading) => (
            <motion.div
              key={reading.id}
              id={reading.id}
              className="vu-bb-tally"
              variants={slideInQuick}
            >
              <span className="vu-bb-tally-label">{reading.label}</span>
              <span className="vu-bb-tally-value">{reading.value}</span>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </div>
  )
}

/** The six honest words as an attribute, so the pairs live in CSS beside every other key. */
function tagSlug(tag: string): string {
  return tag.toLowerCase().replace(/\s+/g, '-')
}

/**
 * One contact suggestion card: her face and four readings — who she is, where she lives, what
 * she reads for, her hour — with her name in its own column. The whole card is the control.
 */
function ContactCard({
  charId,
  character,
  info,
  tag,
  status,
  onOpen
}: {
  charId: string
  character: Character
  info: CharInfo
  tag: string
  status: Presence
  onOpen: () => void
}): JSX.Element {
  const version = useSpriteVersion(charId)
  return (
    <motion.div variants={slideInQuick}>
      <motion.button
        className="vu-bb-card"
        type="button"
        // It expands under the cursor and keeps the tint under the swell: a scale alone
        // is dropped outright for a player who has asked for less motion.
        {...gestures(false, cardSwell, rowPress)}
        onClick={onOpen}
      >
        <span className="vu-bb-crop">
          <img className="vu-crop-img" src={profileUrl(charId, version)} alt="" />
        </span>
        <span className="vu-bb-card-main">
          <span className="vu-bb-name">{fullNameOf(character)}</span>
          {info.handle && <span className="vu-bb-handle">@{info.handle}</span>}
          <span className="vu-bb-card-line">
            {yearLabel(info.year)} · {info.major}
          </span>
          <span className="vu-bb-where">
            <BusyLed busy={status.busy} />
            {status.text}
          </span>
        </span>
        <span className="vu-bb-tag" data-tag={tagSlug(tag)}>
          {tag}
        </span>
      </motion.button>
    </motion.div>
  )
}

/**
 * One of the three the slot drew: her name, address and the one thing he can do about her beside
 * her face, which is a control too, opening the page every face in the app opens.
 */
function SuggestCard({
  charId,
  character,
  handle,
  requested,
  onOpen
}: {
  charId: string
  character: Character | undefined
  handle: string | undefined
  requested: boolean
  onOpen: () => void
}): JSX.Element | null {
  const version = useSpriteVersion(charId)
  if (!character) return null

  return (
    <motion.div className="vu-bb-suggest" variants={slideInQuick}>
      <FaceButton name={fullNameOf(character)} onOpen={onOpen}>
        <span className="vu-bb-crop">
          <img className="vu-crop-img" src={profileUrl(charId, version)} alt="" />
        </span>
      </FaceButton>
      <span className="vu-bb-suggest-main">
        <span className="vu-bb-suggest-name">{fullNameOf(character)}</span>
        {handle && <span className="vu-bb-handle">@{handle}</span>}
        <PrimaryButton
          id={`bb-add-${charId}`}
          dead={requested}
          onClick={() => sendFriendRequest(charId)}
        >
          {requested ? 'Requested' : 'Add'}
        </PrimaryButton>
      </span>
    </motion.div>
  )
}

/**
 * One post as the Updates tab draws it: a contact's, a stranger's wearing the one control that
 * does anything about her, or the day's random student. It is the row, it deals itself in, and
 * it redraws only when its own post does.
 */
const FeedPost = memo(function FeedPost({
  charId,
  emoji,
  name,
  handle,
  post,
  stranger,
  requested,
  random
}: {
  charId?: string
  emoji?: string
  name: string
  handle?: string
  post: { id?: string; text: string; date: number; time: TimeSlot; likes: number; liked?: boolean }
  /** Somebody he has no contact info for — the one route by which one reaches his feed. */
  stranger?: boolean
  /** She already has his request, so the control that sent it is spent. */
  requested?: boolean
  /** The day's own student, whose like is the slot's rather than a post on somebody's feed. */
  random?: boolean
}): JSX.Element {
  // Her page, her like and the request for her number, each addressed to the store from here
  // rather than handed down, so nothing but the post itself changes under the row.
  const open = charId ? () => useBunnyboardStore.getState().openPage(charId) : undefined
  const add = stranger && charId ? () => sendFriendRequest(charId) : undefined
  const like = (): void => {
    if (random) useGameStore.getState().toggleRandomPostLike()
    else if (charId && post.id) useGameStore.getState().toggleFeedLike(charId, post.id)
  }

  // A person's face is ringed in the accent wherever it is listed; a bot's and the random
  // student's are not — she is one of the four thousand people the roster is not.
  const face = <Portrait charId={charId} emoji={emoji} ring={Boolean(charId)} size="sm" />
  const modifier = stranger
    ? ' vu-bb-post'
    : charId
      ? ''
      : ' vu-bb-post--random'

  return (
    <motion.div
      className={`vu-bb-post${post.liked ? ' vu-bb-post--liked' : ''}${modifier}`}
      variants={slideInQuick}
    >
      <div className="vu-bb-post-head">
        {open ? (
          <FaceButton name={name} onOpen={open}>
            {face}
          </FaceButton>
        ) : (
          <span className="vu-bb-face-btn">{face}</span>
        )}
        <div className="vu-bb-post-who">
          <div className="vu-bb-post-name">
            {name}
          </div>
          <div className="vu-bb-post-meta">
            {/* Absent when there is none: a handle is never minted at render. */}
            {handle && <span>@{handle}</span>}
            {handle && <span className="vu-bb-thread-dot">·</span>}
            <span className="vu-bb-post-when">
              {formatShortGameDate(post.date)} · {slotHalf(post.time)}
            </span>
          </div>
        </div>
        {add && (
          <PrimaryButton id={`bb-add-post-${charId}`} dead={requested} onClick={add}>
            {requested ? 'Requested' : 'Add Friend'}
          </PrimaryButton>
        )}
      </div>
      <p className="vu-bb-post-text">{post.text}</p>
      <motion.button
        className={`vu-bb-like${post.liked ? ' vu-bb-like--on' : ''}`}
        type="button"
        aria-pressed={Boolean(post.liked)}
        {...gestures(false, quietLift, quietPress)}
        onClick={like}
      >
        <HeartIcon />
        {post.likes + (post.liked ? 1 : 0)}
      </motion.button>
    </motion.div>
  )
})

/**
 * The day two of them became friends, on the check-in's own row; it redraws only when the pair
 * it names does.
 */
const FriendshipRow = memo(function FriendshipRow({
  pair,
  one,
  two
}: {
  pair: NpcFriendship
  one: Character
  two: Character
}): JSX.Element {
  const openPage = useBunnyboardStore.getState().openPage
  return (
    <motion.div className="vu-row vu-bb-checkin vu-bb-made" variants={slideInQuick}>
      <FaceButton name={one.firstName} onOpen={() => openPage(pair.a)}>
        <Portrait charId={pair.a} ring size="sm" />
      </FaceButton>
      <FaceButton name={two.firstName} onOpen={() => openPage(pair.b)}>
        <Portrait charId={pair.b} ring size="sm" />
      </FaceButton>
      <span>
        {one.firstName} and {two.firstName} are now friends.
      </span>
    </motion.div>
  )
})

/** Where somebody is right now, on her own row; it redraws only when the place it names does. */
const CheckInRow = memo(function CheckInRow({
  name,
  label
}: {
  name: string
  label: string
}): JSX.Element {
  return (
    <motion.div className="vu-row vu-bb-checkin" variants={slideInQuick}>
      <MapIcon />
      <span>
        {name} updated their location: {label}
      </span>
    </motion.div>
  )
})

/**
 * What a row is keyed on: the post it draws, the pair it names, the girl checking in, or the
 * day's own student.
 */
function feedRowKey(entry: FeedEntry): string {
  if (entry.kind === 'friendship') return `friends:${entry.pair.a}|${entry.pair.b}`
  if (entry.kind === 'checkIn') return `checkin:${entry.charId}`
  return entry.kind === 'random' ? 'random-student' : entry.post.id
}

/** Whether a page's rows are the same things drawn on the same objects they were. */
function samePage(before: readonly FeedEntry[], now: readonly FeedEntry[]): boolean {
  if (before.length !== now.length) return false
  return now.every((entry, at) => {
    const was = before[at]
    if (was.kind !== entry.kind) return false
    if (entry.kind === 'friendship') return was.kind === 'friendship' && was.pair === entry.pair
    if (entry.kind === 'checkIn') {
      return was.kind === 'checkIn' && was.charId === entry.charId && was.label === entry.label
    }
    if (entry.kind === 'random') return was.kind === 'random' && was.post === entry.post
    return was.kind === 'post' && was.post === entry.post && was.stranger === entry.stranger
  })
}

/** One row, whichever kind of thing the entry is. */
function rowOf(entry: FeedEntry, requestsSent: readonly string[]): JSX.Element {
  if (entry.kind === 'friendship') {
    const { pair, one, two } = entry
    return <FriendshipRow key={feedRowKey(entry)} pair={pair} one={one} two={two} />
  }
  if (entry.kind === 'checkIn') {
    return <CheckInRow key={feedRowKey(entry)} name={entry.name} label={entry.label} />
  }
  if (entry.kind === 'random') {
    // The handle is her whole identity, so it takes the name line.
    return (
      <FeedPost
        key={feedRowKey(entry)}
        emoji={entry.post.emoji}
        name={entry.post.handle}
        post={entry.post}
        random
      />
    )
  }
  const { charId, post } = entry
  return (
    <FeedPost
      key={feedRowKey(entry)}
      charId={charId}
      name={entry.name}
      handle={entry.handle}
      post={post}
      stranger={entry.stranger}
      requested={entry.stranger && requestsSent.includes(charId)}
    />
  )
}

/** One page of the feed's rows, dealing itself in; it redraws only when its own slice changes. */
const FeedPage = memo(function FeedPage({
  entries,
  requestsSent
}: {
  entries: readonly FeedEntry[]
  requestsSent: readonly string[]
}): JSX.Element {
  return (
    <motion.div className="vu-bb-rows" variants={LIST_DEAL}>
      {entries.map((entry) => rowOf(entry, requestsSent))}
    </motion.div>
  )
})

/** The feed: every contact's posts, plus the things the day surfaces from outside that list. */
function UpdatesFeed(): JSX.Element {
  const chars = useGameStore((s) => s.chars)
  const characters = useGameStore((s) => s.characters)
  const charInfo = useGameStore((s) => s.charInfo)
  const feedExtras = useGameStore((s) => s.feedExtras)
  const npcFriendships = useGameStore((s) => s.npcFriendships)
  const requestsSent = useGameStore((s) => s.bunnyboard.requestsSent)
  const date = useGameStore((s) => s.date)
  const time = useGameStore((s) => s.time)
  const epilogue = useGameStore(epilogueOf)
  // The layered read behind a check-in goes to the store itself, so the three things it can
  // move a girl by are selected here to redraw the feed when one of them does.
  const occasions = useGameStore((s) => s.occasions)
  const springBreakAway = useGameStore((s) => s.springBreakAway)
  const npcOverlay = useGameStore((s) => s.npcOverlay)

  // Everybody he can contact, the strangers the day surfaced, who became friends, where this
  // slot puts each contact who is not posting about it herself, and the day's own student, in
  // one newest-first list. `requestsSent` is read only where a stranger draws.
  const entries = useMemo(() => {
    const slot = shiftSlotOf(shiftWeekdayOf(date), time)
    const checkIns = chars.flatMap((charId) => {
      // Nowhere, on the goodbye menu: a screen set sometime after graduation pins her to no
      // hour, so there is no right now for the row to be about.
      if (epilogue) return []
      const info = charInfo[charId]
      const character = characters[charId]
      if (!info || !character) return []
      // A check-in keeps the map's own gate: never a girl he cannot name.
      if (!info.nameKnown) return []
      const location = charHiddenLocationNow(charId, date, time)
      const posted = (info.feed ?? []).some((post) => post.date === date && post.time === time)
      if (
        !postsLocationUpdate({
          isContact: isFeedContact(info),
          postedThisSlot: posted,
          // Her own room is not somewhere anybody checks in from.
          location: location === ROOM_LOCATION ? null : location,
          hasHiddenSchedule: info.hiddenSchedule?.[slot] !== undefined
        })
      ) {
        return []
      }
      return [{ charId, name: character.firstName, label: locationLabel(location as string) }]
    })
    return updatesFeed({
      chars,
      characters,
      charInfo,
      npcFriendships,
      feedExtras,
      checkIns,
      date,
      time
    })
  }, [
    chars,
    characters,
    charInfo,
    npcFriendships,
    feedExtras,
    date,
    time,
    epilogue,
    occasions,
    springBreakAway,
    npcOverlay
  ])

  // The list cut into pages: a page nothing happened to keeps the array it had, so its rows
  // keep their identity and it is not drawn again.
  const cutBefore = useRef<FeedEntry[][]>([])
  const slices = useMemo(() => {
    const cut: FeedEntry[][] = []
    for (let at = 0; at < entries.length; at += FEED_PAGE) {
      const page = entries.slice(at, at + FEED_PAGE)
      const before = cutBefore.current[cut.length]
      cut.push(before && samePage(before, page) ? before : page)
    }
    cutBefore.current = cut
    return cut
  }, [entries])

  // How much of the feed is mounted: one page, and one more per click of Load more, never
  // past the end of a list a block mid-session can shorten under a page already loaded.
  const [pages, setPages] = useState(1)
  const shownPages = Math.min(pages, slices.length)
  const more = shownPages < slices.length
  const nothing = entries.length === 0

  return (
    <div className="vu-bb-page">
      <div className="vu-title vu-bb-title">
        <h2 className="vu-title-text">Updates</h2>
      </div>

      <div className="vu-bb-scroll">
        {nothing ? (
          <p className="vu-empty vu-empty--flush">No updates yet.</p>
        ) : (
          <div className="vu-bb-pages">
            {slices.slice(0, shownPages).map((slice, page) => (
              <FeedPage key={page} entries={slice} requestsSent={requestsSent} />
            ))}
            {more && (
              <motion.button
                id="bb-feed-more"
                className="vu-bb-more"
                type="button"
                variants={slideInQuick}
                {...gestures(false, rowLift, rowPress)}
                onClick={() => setPages((shown) => shown + 1)}
              >
                Load more
              </motion.button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
