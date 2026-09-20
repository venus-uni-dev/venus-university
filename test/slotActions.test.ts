import { describe, expect, it } from 'vitest'
import { slotOf } from '@shared/classes'
import { newJobState } from '@shared/jobs'
import { meetingDatesOf } from '../src/renderer/prompts/occasions'
import { resetFillerCache, slotActionsNow } from '../src/renderer/stores/slotActions'
import { useGameStore } from '../src/renderer/stores/gameStore'
import { useGrabBagStore } from '../src/renderer/stores/grabBagStore'
import { calendarEvent, classEntry } from './fixtures'

/**
 * The buttons a slot opens with: everything the reader already committed this half-day to is
 * something the app knows, and the row is how it reminds him.
 */

/** Monday day: class slot 0, shift slot 0, and nothing on the occasion calendar. */
const MONDAY = 35
const MONDAY_DAY = slotOf(0, 0)

/** An empty Monday — no plans, no class, no job, no project. */
function seed(): void {
  useGameStore.getState().reset()
  useGameStore.setState({ date: MONDAY, time: 0 })
  resetFillerCache()
  useGrabBagStore.getState().reset()
}

/** Puts the reader in a lecture this slot. */
function enroll(kind: 'lecture' | 'project' = 'lecture'): void {
  const code = kind === 'project' ? 'ART 110' : 'BIO 210'
  useGameStore.setState({
    classes: {
      [code]: classEntry({
        code,
        name: kind === 'project' ? 'Drawing' : 'Cell Biology',
        slot: MONDAY_DAY,
        kind
      })
    },
    playerSchedule: { [MONDAY_DAY]: code }
  })
}

/** Marks the project's assignment meeting as having happened — attended or ditched. */
function meetFirstClass(attended = true): void {
  useGameStore.setState({
    classRecords: {
      'ART 110': { meetings: [{ date: meetingDatesOf(MONDAY_DAY)[0], attended }] }
    }
  })
}

/** Tuesday day: a second project class, so the reader is carrying two of them. */
const TUESDAY_DAY = slotOf(1, 0)

/** Enrolls a second project class and holds its assignment meeting too. */
function enrollSecondProject(): void {
  const game = useGameStore.getState()
  useGameStore.setState({
    classes: {
      ...game.classes,
      'CWR 305': classEntry({
        code: 'CWR 305',
        name: 'Creative Writing',
        slot: TUESDAY_DAY,
        kind: 'project'
      })
    },
    playerSchedule: { ...game.playerSchedule, [TUESDAY_DAY]: 'CWR 305' },
    classRecords: {
      ...game.classRecords,
      'CWR 305': { meetings: [{ date: meetingDatesOf(TUESDAY_DAY)[0], attended: true }] }
    }
  })
}

describe('slotActionsNow', () => {
  it('sends the class button with a blank code, which is what resolves it', () => {
    // The blank is deliberate: `castForClass` answers it off the reader's own
    // schedule, through the one function that owns the refusals.
    seed()
    enroll()
    expect(slotActionsNow()[0].verdict).toEqual({
      mentioned: [],
      mentionedOnly: [],
      actionType: 'goto_class:',
      inPublic: true,
      sceneLocation: ''
    })
  })

  it('leaves the two people-shaped buttons to the classifier', () => {
    // An event names its attendees and a filler names a place; who ends up in the
    // scene is exactly what the classifier is for.
    seed()
    useGameStore.setState({ events: [calendarEvent({ date: MONDAY, time: 0 })] })
    const actions = slotActionsNow()
    expect(actions[0].verdict).toBeNull()
    for (const filler of actions.filter((action) => action.tone === 'idle')) {
      expect(filler.verdict).toBeNull()
    }
  })

  it('offers a plan only in the slot it was made for', () => {
    seed()
    useGameStore.setState({
      events: [
        calendarEvent({ id: 'now', date: MONDAY, time: 0, title: 'Dinner' }),
        calendarEvent({ id: 'tonight', date: MONDAY, time: 1, title: 'Drinks' }),
        calendarEvent({ id: 'tomorrow', date: MONDAY + 1, time: 0, title: 'Study' })
      ]
    })
    const plans = slotActionsNow().filter((action) => action.tone === 'plan')
    expect(plans).toEqual([{ key: 'event:now', text: 'Dinner', tone: 'plan', verdict: null }])
  })

  it('offers the shift the reader is rostered for', () => {
    seed()
    useGameStore.setState({ job: newJobState('cutetea', [0], 0) })
    expect(slotActionsNow()[0]).toMatchObject({
      key: 'job:cutetea',
      text: 'Work at CuteTea',
      tone: 'shift'
    })
    expect(slotActionsNow()[0].verdict).toMatchObject({ actionType: 'job' })
  })

  it('says nothing about a shift in a slot he is not rostered for', () => {
    seed()
    useGameStore.setState({ job: newJobState('cutetea', [1], 0) })
    expect(slotActionsNow().every((action) => action.tone !== 'shift')).toBe(true)
  })

  it('offers a button for every project, not just the most urgent one', () => {
    // Two project classes are two commitments, and collapsing them into the
    // nearer showcase would hide the other exactly as if he had never enrolled.
    seed()
    enroll('project')
    meetFirstClass()
    enrollSecondProject()
    const projects = slotActionsNow().filter((action) => action.tone === 'project')
    expect(projects.map((action) => action.key)).toEqual(['project:ART 110', 'project:CWR 305'])
    // Each carries its own code, so pressing one cannot land on the other.
    expect(projects.map((action) => action.verdict?.actionType)).toEqual([
      'project:ART 110',
      'project:CWR 305'
    ])
    expect(projects.map((action) => action.text)).toEqual([
      'Work on Drawing project',
      'Work on Creative Writing project'
    ])
  })

  it('holds the project back until its assignment class day has passed', () => {
    // No record on the assignment meeting means the day has not happened, and a
    // project that has not been handed out is not something to work on.
    seed()
    enroll('project')
    expect(slotActionsNow().every((action) => action.tone !== 'project')).toBe(true)

    // A ditched assignment day still counts: the class met without him.
    meetFirstClass(false)
    expect(slotActionsNow().some((action) => action.tone === 'project')).toBe(true)
  })

  it('fills idle rows with the reader\'s weakest stats first, stable within the slot', () => {
    seed()
    useGameStore.setState({ stats: { brain: 30, body: 10, heart: 10 } })
    const actions = slotActionsNow()
    expect(actions.map((action) => action.key)).toEqual(['stat:body', 'stat:heart', 'stat:brain'])
    expect(actions[0].text.startsWith('Improve Body')).toBe(true)
    expect(actions[1].text.startsWith('Improve Heart')).toBe(true)
    expect(actions[2].text.startsWith('Improve Brain')).toBe(true)

    // A recompute in the same slot draws nothing new: the same sentences come back.
    const again = slotActionsNow()
    expect(again.map((action) => action.text)).toEqual(actions.map((action) => action.text))
  })
})
