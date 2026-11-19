import { describe, expect, it } from 'vitest'
import { EVENT_COOLDOWN_DAYS } from '@shared/odds'
import {
  eligibleSceneEvents,
  receivedGiftChance,
  rollSceneEvent,
  withFiredEvent,
  type SceneEventContext
} from '@shared/sceneEvents'
import { itemDefOf, receivedGiftPool } from '@shared/shop'

/**
 * The scene events' cooldowns and gates. The record of when each fired is save state, and a
 * cancelled meeting asks no exam question, so an event let through where it should not be is a
 * quietly wrong grade or an event repeating every week.
 */

/** A private scene alone with one girl, nowhere in particular, in no class. */
function ctx(over: Partial<SceneEventContext> = {}): SceneEventContext {
  return {
    date: 60,
    time: 1,
    cast: [{ charId: 'a', onPeriod: false }],
    inPublic: false,
    wet: false,
    indoors: null,
    onCampus: null,
    classKind: null,
    syllabusWeek: false,
    cancellable: false,
    lessNsfwText: false,
    ...over
  }
}

const idsOf = (context: SceneEventContext, fired = {}): string[] =>
  eligibleSceneEvents(context, fired).map((entry) => entry.id)

describe('rollSceneEvent', () => {
  it('fires nothing on the day another event fired, and is free again the next', () => {
    const always = (): number => 0
    expect(rollSceneEvent(ctx({ date: 60 }), { hiccups: 60 }, always)).toBeNull()
    expect(rollSceneEvent(ctx({ date: 61 }), { hiccups: 60 }, always)).not.toBeNull()
  })

  it('keeps one landed event, its girl one of the cast', () => {
    const event = rollSceneEvent(
      ctx({ cast: [{ charId: 'a', onPeriod: false }, { charId: 'b', onPeriod: false }] }),
      {},
      () => 0.5 * 0.01
    )
    expect(event).not.toBeNull()
    expect(['a', 'b']).toContain(event?.charId)
  })

  it('rolls nothing for a scene with nobody in it', () => {
    expect(rollSceneEvent(ctx({ cast: [] }), {}, () => 0)).toBeNull()
  })
})

describe('eligibleSceneEvents', () => {
  it('holds an event until its cooldown has run, and only that event', () => {
    const fired = { injury: 60 - EVENT_COOLDOWN_DAYS + 1 }
    expect(idsOf(ctx(), fired)).not.toContain('injury')
    expect(idsOf(ctx(), fired)).toContain('hiccups')
    expect(idsOf(ctx(), { injury: 60 - EVENT_COOLDOWN_DAYS })).toContain('injury')
  })

  // The meetings that grade him must go ahead: a cancellation asks no question and costs no skip.
  it('cancels only an ordinary meeting of a course, and never a PE class', () => {
    expect(idsOf(ctx({ classKind: 'course', inPublic: true, cancellable: true }))).toContain(
      'classCancelled'
    )
    expect(idsOf(ctx({ classKind: 'course', inPublic: true }))).not.toContain('classCancelled')
    expect(idsOf(ctx({ classKind: 'pe', inPublic: true, cancellable: true }))).not.toContain(
      'classCancelled'
    )
  })

  it('keeps the public events out of class and the room events out of public', () => {
    const lecture = idsOf(ctx({ classKind: 'course', inPublic: true }))
    expect(lecture).not.toContain('strayDog')
    expect(idsOf(ctx({ inPublic: true }))).toContain('strayDog')

    const invite = { charId: 'a', kind: 'herRoom' as const }
    expect(idsOf(ctx({ invite }))).toContain('herAsleep')
    expect(idsOf(ctx({ invite, inPublic: true }))).not.toContain('herAsleep')
  })

  it('happens to the host for a room event, and to a girl on her period for an accident', () => {
    const cast = [
      { charId: 'a', onPeriod: false },
      { charId: 'b', onPeriod: true }
    ]
    const eligible = eligibleSceneEvents(ctx({ cast, invite: { charId: 'a', kind: 'hisRoom' } }), {})
    expect(eligible.find((entry) => entry.id === 'hisLate')?.targets).toEqual(['a'])
    expect(eligible.find((entry) => entry.id === 'periodAccident')?.targets).toEqual(['b'])
    // Not alone with her: nothing romantic is set up for a crowd.
    expect(eligible.map((entry) => entry.id)).not.toContain('herRomance')
  })

  it('withholds the NSFW events under less NSFW text', () => {
    const invite = { charId: 'a', kind: 'herRoom' as const }
    const ids = idsOf(ctx({ invite, lessNsfwText: true, classKind: null }))
    expect(ids).not.toContain('herMasturbating')
    expect(ids).not.toContain('wardrobe')
    expect(idsOf(ctx({ invite }))).toContain('herMasturbating')
  })
})

describe('withFiredEvent', () => {
  it('records the day and is the same record when it already says so', () => {
    const fired = withFiredEvent({}, 'hiccups', 12)
    expect(fired).toEqual({ hiccups: 12 })
    expect(withFiredEvent(fired, 'hiccups', 12)).toBe(fired)
  })
})

describe('the present she brings', () => {
  it('draws under her tier’s price only what is made for anybody or for the reader’s gender', () => {
    const friendly = receivedGiftPool('friendly', 'male', false)
    expect(friendly.length).toBeGreaterThan(0)
    expect(
      friendly.every((item) => (item.madeFor ?? 'male') === 'male' && item.price < 60)
    ).toBe(true)
    expect(receivedGiftPool('devoted', 'male', false).some((item) => item.price >= 150)).toBe(true)

    const ids = (reader: 'female' | 'male' | null) =>
      receivedGiftPool('devoted', reader, false).map((item) => item.id)
    expect(itemDefOf('cedar_noir_cologne')?.madeFor).toBe('male')
    expect(ids('male')).toContain('cedar_noir_cologne')
    expect(ids('female')).not.toContain('cedar_noir_cologne')
    expect(ids(null)).not.toContain('cedar_noir_cologne')
    expect(ids('female')).toContain('diamond_necklace')
    expect(receivedGiftPool('devoted', null, true).every((item) => item.madeFor === undefined)).toBe(
      true
    )
  })

  it('brings an intimate item only as his lover', () => {
    expect(itemDefOf('veridan_lingerie_set')?.intimate).toBe(true)
    expect(itemDefOf('dreams_satin_boxers')?.intimate).toBe(true)
    for (const reader of ['female', 'male'] as const) {
      expect(receivedGiftPool('devoted', reader, false).some((item) => item.intimate)).toBe(false)
      expect(receivedGiftPool('devoted', reader, true).some((item) => item.intimate)).toBe(true)
    }
    expect(receivedGiftPool('devoted', 'female', true).map((item) => item.id)).toContain(
      'veridan_lingerie_set'
    )
    expect(receivedGiftPool('devoted', 'male', true).map((item) => item.id)).not.toContain(
      'veridan_lingerie_set'
    )
  })

  it('grows with her tier and with being his lover', () => {
    const base = receivedGiftChance({
      invite: 'hisRoom',
      disposition: 'friendly',
      lover: false,
      reader: 'male'
    })
    expect(
      receivedGiftChance({ invite: 'hisRoom', disposition: 'devoted', lover: true, reader: 'male' })
    ).toBeCloseTo(
      base * 2.5
    )
  })
})
