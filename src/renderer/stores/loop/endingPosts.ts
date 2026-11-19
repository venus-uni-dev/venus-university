import { messageOf } from '@shared/errors'
import { isGameOver } from '@shared/money'
import { LAST_SEMESTER } from '@shared/semesters'
import {
  charKeyOf,
  type EndingPostsResponse,
  type StructuredRequest,
  type TimeSlot
} from '@shared/types'
import { buildEndingPostsPrompt, type EndingPoster } from '../../prompts/endingPostsPrompt'
import { GRADUATION_DATE } from '../../prompts/occasions'
import { hasTexted } from '../../prompts/textingPrompt'
import { rollEndingPostStamp } from '../feedRolls'
import { endingPostsDelivered, isFeedContact } from '../feedView'
import { useGameStore } from '../gameStore'
import { settingNow } from '../lorebookStore'
import { retrySilently } from '../silentRetry'
import { deliverEndingPosts } from './feed'
import { lessNsfwTextNow, reader, secretBudgetNow } from './promptState'
import { writeEpilogueSave } from './saves'
import { currentRun, loopState, runStale, LOOP_LLM_GROUP } from './state'

/**
 * What the reader's contacts post in the week after graduation: one call, filed straight onto
 * their feeds at the stamps this module rolls for them.
 */

/** Sends the prompt, re-sending itself quietly for as long as its budget lasts. */
async function send(
  request: StructuredRequest,
  run: object
): Promise<EndingPostsResponse | null> {
  for (let spent = 0; ; spent++) {
    const result = await window.api.llm.completeEndingPosts(request, LOOP_LLM_GROUP)
    if (runStale(run)) return null
    if (result.ok) return result.data
    const again = await retrySilently('ending posts', result.error, spent, {
      // Cut short when the playthrough is left.
      onSleep: (cancel) => loopState.parkedWaiters.push(cancel)
    })
    if (runStale(run)) return null
    if (!again) {
      console.warn('[ending] no status updates:', result.error.message)
      return null
    }
  }
}

/** Asks for the posts and files them, one contact at a time, onto her own feed. */
async function fetchEndingPosts(
  posters: readonly EndingPoster[],
  stamps: Readonly<Record<string, { date: number; time: TimeSlot }>>
): Promise<void> {
  const run = currentRun()
  try {
    const game = useGameStore.getState()
    const request = buildEndingPostsPrompt(
      {
        playthroughId: game.playthroughId ?? 'unsaved',
        stats: game.stats,
        lessNsfwText: lessNsfwTextNow(),
        secretBudget: secretBudgetNow(),
        season: game.calendar.season,
        readerGraduated: game.semesterIndex === LAST_SEMESTER,
        posters,
        romance: game.romance,
        readerPronouns: game.playerPronouns,
        npcRelationships: game.npcRelationships,
        people: [...game.chars, ...game.alumni].flatMap((charId) =>
          game.characters[charId] ? [game.characters[charId]] : []
        )
      },
      settingNow(),
      reader()
    )

    const reply = await send(request, run)
    if (runStale(run) || !reply) return

    const filed = deliverEndingPosts(reply.posts ?? [], stamps)
    if (filed === 0) console.warn('[ending] the status-update call filed no posts')

    // Guarded where `armEndingArt`'s claim write is not: this reply lands while the shop is
    // open on the goodbye menu, and a balance past the floor must not reach the autosave, since
    // the debt gag is played off the save taken before it.
    const after = useGameStore.getState()
    if (after.graduationSeen && !isGameOver(after.money)) void writeEpilogueSave()
  } catch (err) {
    console.warn('[ending] no status updates:', messageOf(err))
  }
}

/** Starts the epilogue's status updates, unless this playthrough already has them. */
export function armEndingPosts(): void {
  if (loopState.endingPosts) return
  loopState.endingPosts = true

  const game = useGameStore.getState()
  if (endingPostsDelivered(game.chars, game.charInfo)) return

  const stamps: Record<string, { date: number; time: TimeSlot }> = {}
  const posters: EndingPoster[] = []
  for (const charId of game.chars) {
    const info = game.charInfo[charId]
    const character = game.characters[charId]
    if (!character || !isFeedContact(info)) continue
    const charKey = charKeyOf(character.firstName, character.lastName)
    const stamp = rollEndingPostStamp(Math.random)
    stamps[charKey] = stamp
    posters.push({
      character,
      info,
      charKey,
      texted: hasTexted(game.bunnyboard.conversations[charId]),
      graduating: game.graduating.includes(charId),
      daysAfter: stamp.date - GRADUATION_DATE,
      time: stamp.time
    })
  }
  if (posters.length === 0) return

  const run = currentRun()
  const call = fetchEndingPosts(posters, stamps)
  loopState.endingPostsCall = call
  game.setEndingPostsPending(true)
  // Cleared once settled, unless a later stay has taken the field over.
  void call.finally(() => {
    if (runStale(run) || loopState.endingPostsCall !== call) return
    loopState.endingPostsCall = null
    useGameStore.getState().setEndingPostsPending(false)
  })
}
