import { describe, expect, it } from 'vitest'
import type { Weather } from '@shared/weather'
import { soundscapeOf, stingsOf, type SoundFacts } from '../src/renderer/stores/soundscape'

/**
 * Which of the four channels answers to what, and what one step of the same facts fires. Every
 * way the mix can go wrong is silent — a theme restarting on every menu visit, a room tone left
 * running under a cut, a breath outliving its CG, a sting fired by a load — and nothing throws.
 */

/** A menu at rest, with the title neither started nor finished; `over` moves one fact. */
function facts(over: Partial<SoundFacts> = {}): SoundFacts {
  return {
    view: 'mainMenu',
    menuTheme: 'day',
    titleStarted: false,
    titleDone: false,
    music: null,
    crossing: { phase: 'idle', splash: false, waited: false },
    nsfwSound: true,
    game: null,
    ...over
  }
}

/** A slot at rest on the landing, in a dorm room in daylight; `over` moves one fact. */
function inGame(over: Partial<NonNullable<SoundFacts['game']>> = {}): SoundFacts {
  return facts({
    view: 'game',
    titleStarted: true,
    titleDone: true,
    game: {
      gameOver: false,
      landing: true,
      inScene: false,
      solo: false,
      narrating: false,
      bg: { base: 'lowrise_dorm_room', kind: 'interior' },
      half: 'day',
      weather: 'clear',
      epilogue: false,
      cg: null,
      loads: 0,
      modal: null,
      line: null,
      texts: { in: 0, out: 0 },
      quizRight: 0,
      ...over
    }
  })
}

describe('the title theme', () => {
  it('plays on the first Main Menu and is never asked for again', () => {
    expect(soundscapeOf(facts()).music).toEqual({ key: 'title', fade: 0.5 })

    // Started and still running: the menu leaves it alone rather than restarting it.
    expect(soundscapeOf(facts({ titleStarted: true })).music).toBe('keep')

    // And once it is done, the menu never asks for it a second time.
    const done = soundscapeOf(facts({ titleStarted: true, titleDone: true })).music
    expect(done).toEqual({ key: null, fade: 30 })
  })

  it('follows the player off the Main Menu and back without restarting', () => {
    const roster = soundscapeOf(facts({ view: 'manageCharacters', titleStarted: true }))
    expect(roster.music).toBe('keep')
    expect(roster.ambience).toEqual({ key: null, fade: 1.5 })

    // The two setup screens reached from the menu hold the title too.
    expect(soundscapeOf(facts({ view: 'apiKey', titleStarted: true })).music).toBe('keep')
    expect(soundscapeOf(facts({ view: 'setup', titleStarted: true })).music).toBe('keep')
  })
})

describe('the menu ambience', () => {
  it('waits for the title to finish, then follows the player onto the satellite screens', () => {
    // Nothing outdoors while the theme is still playing.
    expect(soundscapeOf(facts({ titleStarted: true })).ambience).toEqual({ key: null, fade: 1.5 })

    const menu = soundscapeOf(facts({ titleStarted: true, titleDone: true }))
    expect(menu.ambience).toEqual({ key: 'amb_outdoor_day', fade: 1.5 })

    // A satellite screen is not the menu, but the ambience follows it there too.
    const newGame = soundscapeOf(facts({ view: 'newGame', titleStarted: true, titleDone: true }))
    expect(newGame.ambience).toEqual({ key: 'amb_outdoor_day', fade: 1.5 })
  })

  it('takes the half the menu is drawn in', () => {
    const night = facts({ titleStarted: true, titleDone: true, menuTheme: 'night' })
    expect(soundscapeOf(night).ambience).toEqual({ key: 'amb_outdoor_night', fade: 1.5 })
  })
})

describe('boot and the first run', () => {
  it('play nothing at all', () => {
    for (const view of ['boot', 'firstRun'] as const) {
      const mix = soundscapeOf(facts({ view }))
      expect(mix).toEqual({
        music: { key: null, fade: 1 },
        ambience: { key: null, fade: 1 },
        act: { key: null, fade: 1 },
        breath: { key: null, fade: 1 }
      })
    }
  })
})

describe('a crossing', () => {
  it('holds every channel while the curtain is still coming down', () => {
    const closing = inGame()
    closing.crossing = { phase: 'closing', splash: false, waited: false }
    expect(soundscapeOf(closing)).toEqual({
      music: 'keep',
      ambience: 'keep',
      act: 'keep',
      breath: 'keep'
    })
  })

  it('empties the stage under a day change and keeps only a landing theme under a scene opening', () => {
    const splash = inGame()
    splash.crossing = { phase: 'holding', splash: true, waited: true }
    expect(soundscapeOf(splash)).toEqual({
      music: { key: null, fade: 0.8 },
      ambience: { key: null, fade: 0.8 },
      act: { key: null, fade: 0.8 },
      breath: { key: null, fade: 0.8 }
    })

    const opening = inGame()
    opening.crossing = { phase: 'holding', splash: false, waited: true }
    opening.music = 'landing_day'
    const mix = soundscapeOf(opening)
    expect(mix.music).toBe('keep')
    expect(mix.ambience).toEqual({ key: null, fade: 0.8 })

    // The same hold on the way in from the menu: the title stops at the door.
    opening.music = 'title'
    expect(soundscapeOf(opening).music).toEqual({ key: null, fade: 0.8 })
  })

  it('takes the theme away under a cover that is waiting on nothing', () => {
    // The cover a loaded save is opened behind: no splash, and no wait declared either. The
    // theme it finds belongs to the game being left, and the save decides the mix from scratch.
    const load = inGame()
    load.crossing = { phase: 'holding', splash: false, waited: false }
    load.music = 'landing_day'
    expect(soundscapeOf(load).music).toEqual({ key: null, fade: 0.8 })
  })
})

describe('a slot', () => {
  it('picks the landing theme for the half of the day', () => {
    expect(soundscapeOf(inGame()).music).toEqual({ key: 'landing_day', fade: 0.5 })
    expect(soundscapeOf(inGame({ half: 'night' })).music).toEqual({
      key: 'landing_night',
      fade: 0.5
    })
  })

  it('gives the graduation epilogue a theme of its own', () => {
    expect(soundscapeOf(inGame({ epilogue: true, half: 'night' })).music).toEqual({
      key: 'ending',
      fade: 0.5
    })
  })

  it('is silent once the playthrough has ended', () => {
    expect(soundscapeOf(inGame({ gameOver: true }))).toEqual({
      music: { key: null, fade: 1 },
      ambience: { key: null, fade: 1 },
      act: { key: null, fade: 1 },
      breath: { key: null, fade: 1 }
    })
  })
})

describe('a scene', () => {
  it('drops the theme for the place it is in', () => {
    const outdoors = inGame({
      landing: false,
      inScene: true,
      bg: { base: 'quad', kind: 'exterior' }
    })
    expect(soundscapeOf(outdoors).music).toEqual({ key: null, fade: 1.5 })
    expect(soundscapeOf(outdoors).ambience).toEqual({ key: 'amb_outdoor_day', fade: 1.5 })

    const indoors = inGame({
      landing: false,
      inScene: true,
      bg: { base: 'lecture_hall', kind: 'interior' }
    })
    expect(soundscapeOf(indoors).ambience).toEqual({ key: 'amb_indoor', fade: 1.5 })
  })

  it('leaves a private room and an unshipped background with no room tone', () => {
    const bedroom = inGame({
      landing: false,
      inScene: true,
      bg: { base: 'love_hotel', kind: 'interior' }
    })
    expect(soundscapeOf(bedroom).ambience).toEqual({ key: null, fade: 1.5 })

    // A character's own room is not in the shipped set, so it has no category to read.
    const hers = inGame({ landing: false, inScene: true, bg: { base: 'room_ada_lin', kind: null } })
    expect(soundscapeOf(hers).ambience).toEqual({ key: null, fade: 1.5 })
  })

  it('plays the venue\'s own song, in the half of the day the venue plays it', () => {
    const scene = { landing: false, inScene: true } as const

    const bar = inGame({ ...scene, bg: { base: 'bar', kind: 'interior' }, half: 'night' })
    expect(soundscapeOf(bar).music).toEqual({ key: 'venue_rock', fade: 1.5 })
    expect(soundscapeOf(bar).ambience).toEqual({ key: 'amb_indoor', fade: 1.5 })

    // The same bar in daylight has nobody playing in it.
    const day = inGame({ ...scene, bg: { base: 'bar', kind: 'interior' } })
    expect(soundscapeOf(day).music).toEqual({ key: null, fade: 1.5 })

    // And a place with no song on the list stays a room tone alone.
    const hall = inGame({
      ...scene,
      bg: { base: 'lecture_hall', kind: 'interior' },
      half: 'night'
    })
    expect(soundscapeOf(hall).music).toEqual({ key: null, fade: 1.5 })
  })

  it('plays the landing theme and stays out of the room when the reader is alone', () => {
    const solo = {
      landing: false,
      inScene: true,
      solo: true,
      bg: { base: 'quad', kind: 'exterior' }
    } as const
    const mix = soundscapeOf(inGame(solo))
    expect(mix.music).toEqual({ key: 'landing_day', fade: 0.5 })
    expect(mix.ambience).toEqual({ key: null, fade: 1.5 })

    expect(soundscapeOf(inGame({ ...solo, half: 'night' })).music).toEqual({
      key: 'landing_night',
      fade: 0.5
    })
  })
})

describe('the slot opening', () => {
  it('plays the outdoors of its half under the narration and no theme over it', () => {
    const day = soundscapeOf(inGame({ landing: false, narrating: true }))
    expect(day.music).toBe('keep')
    expect(day.ambience).toEqual({ key: 'amb_outdoor_day', fade: 1.5 })

    const night = soundscapeOf(inGame({ landing: false, narrating: true, half: 'night' }))
    expect(night.ambience).toEqual({ key: 'amb_outdoor_night', fade: 1.5 })
  })
})

describe('a wet sky', () => {
  it('takes the outdoor loop outside and the matching indoor loop everywhere else', () => {
    const scene = (kind: 'exterior' | 'interior', weather: Weather) =>
      inGame({
        landing: false,
        inScene: true,
        bg: { base: kind === 'exterior' ? 'quad' : 'lecture_hall', kind },
        weather
      })

    expect(soundscapeOf(scene('exterior', 'rain')).ambience).toEqual({
      key: 'amb_outdoor_rain',
      fade: 1.5
    })
    expect(soundscapeOf(scene('exterior', 'storm')).ambience).toEqual({
      key: 'amb_outdoor_storm',
      fade: 1.5
    })
    expect(soundscapeOf(scene('interior', 'rain')).ambience).toEqual({
      key: 'amb_indoor_rain',
      fade: 1.5
    })
    expect(soundscapeOf(scene('interior', 'storm')).ambience).toEqual({
      key: 'amb_indoor_storm',
      fade: 1.5
    })
  })

  it('reaches a silent room and a character\'s own room too, heard through a window', () => {
    const bedroom = inGame({
      landing: false,
      inScene: true,
      bg: { base: 'love_hotel', kind: 'interior' },
      weather: 'rain'
    })
    expect(soundscapeOf(bedroom).ambience).toEqual({ key: 'amb_indoor_rain', fade: 1.5 })

    const hers = inGame({
      landing: false,
      inScene: true,
      bg: { base: 'room_ada_lin', kind: null },
      weather: 'rain'
    })
    expect(soundscapeOf(hers).ambience).toEqual({ key: 'amb_indoor_rain', fade: 1.5 })
  })

  it('leaves a venue\'s own song alone on the music channel', () => {
    const bar = inGame({
      landing: false,
      inScene: true,
      bg: { base: 'bar', kind: 'interior' },
      half: 'night',
      weather: 'rain'
    })
    expect(soundscapeOf(bar).music).toEqual({ key: 'venue_rock', fade: 1.5 })
    expect(soundscapeOf(bar).ambience).toEqual({ key: 'amb_indoor_rain', fade: 1.5 })
  })

  it('plays under the opening narration', () => {
    const narrating = inGame({ landing: false, narrating: true, weather: 'rain' })
    expect(soundscapeOf(narrating).ambience).toEqual({ key: 'amb_outdoor_rain', fade: 1.5 })
  })

  it('is heard indoors under the landing theme, and stays quiet under a clear sky', () => {
    expect(soundscapeOf(inGame({ weather: 'rain' })).ambience).toEqual({
      key: 'amb_indoor_rain',
      fade: 0.5
    })
    expect(soundscapeOf(inGame({ weather: 'clear' })).ambience).toEqual({ key: null, fade: 0.5 })
  })

  it('plays under a solo scene', () => {
    const solo = inGame({
      landing: false,
      inScene: true,
      solo: true,
      bg: { base: 'quad', kind: 'exterior' },
      weather: 'storm'
    })
    expect(soundscapeOf(solo).ambience).toEqual({ key: 'amb_outdoor_storm', fade: 1.5 })
  })
})

describe('the NSFW sound switch', () => {
  it('takes the act and the breath off a CG that is still on stage', () => {
    const cg = { landing: false, inScene: true, cg: { position: 'sex', voicePitch: 0 } } as const
    const off = { ...inGame(cg), nsfwSound: false }
    const mix = soundscapeOf(off)
    expect(mix.act).toEqual({ key: null, fade: 0.8 })
    expect(mix.breath).toEqual({ key: null, fade: 0.8 })

    // The scene around it is untouched.
    expect(mix.music).toEqual({ key: null, fade: 1.5 })
  })
})

describe('a CG', () => {
  it('lays its act and its breath under the scene, pitched to her voice', () => {
    const handjob = soundscapeOf(
      inGame({ landing: false, inScene: true, cg: { position: 'handjob', voicePitch: 0.5 } })
    )
    expect(handjob.act).toEqual({ key: 'cg_handjob', fade: 0.5 })
    expect(handjob.breath).toEqual({ key: 'cg_breath', fade: 0.5, semitones: 0.5 })

    const sex = soundscapeOf(
      inGame({ landing: false, inScene: true, cg: { position: 'sex', voicePitch: -1 } })
    )
    expect(sex.act).toEqual({ key: 'cg_sex', fade: 0.5 })
    expect(sex.breath).toEqual({ key: 'cg_breath_fast', fade: 0.5, semitones: -3 })
  })

  it('drops the act but not the breath in an afterglow', () => {
    const after = soundscapeOf(
      inGame({ landing: false, inScene: true, cg: { position: 'sex_after', voicePitch: 0 } })
    )
    expect(after.act).toEqual({ key: null, fade: 0.8 })
    expect(after.breath).toEqual({ key: 'cg_breath', fade: 0.5, semitones: 0 })
  })

  it('takes both channels away with the CG', () => {
    const gone = soundscapeOf(inGame({ landing: false, inScene: true, cg: null }))
    expect(gone.act).toEqual({ key: null, fade: 0.8 })
    expect(gone.breath).toEqual({ key: null, fade: 0.8 })
  })
})

describe('a sting', () => {
  it('fires a climax when the act moves into its afterglow, and not on a CG drawn already in one', () => {
    const scene = { landing: false, inScene: true } as const
    const sex = inGame({ ...scene, cg: { position: 'sex', voicePitch: 0 } })
    const after = inGame({ ...scene, cg: { position: 'sex_after', voicePitch: 0 } })
    expect(stingsOf(sex, after)).toEqual(['climax'])

    // A CG that arrives already in its afterglow — a save restored there — has climaxed nowhere.
    expect(stingsOf(inGame(scene), after)).toEqual([])
  })

  it('sounds a modal on its arrival and not while the same one stays', () => {
    const modal = { kind: 'milestone', negative: true } as const
    expect(stingsOf(inGame(), inGame({ modal }))).toEqual(['milestone_sour'])
    expect(stingsOf(inGame({ modal }), inGame({ modal }))).toEqual([])
  })

  it('says nothing across a step that is not the reader playing on', () => {
    const game = inGame({ texts: { in: 3, out: 2 }, quizRight: 1 })
    expect(stingsOf(facts(), game)).toEqual([])
    expect(stingsOf(game, facts())).toEqual([])

    // A save loaded from inside a game: plenty moved, and none of it just happened.
    const loaded = inGame({ loads: 1, texts: { in: 9, out: 7 }, quizRight: 4 })
    expect(stingsOf(game, loaded)).toEqual([])
  })

  it('fires a status line polarity on its arrival, and not while the same line stays', () => {
    const good = {
      speaker: '',
      text: 'Brain went up.',
      status: { marks: [], polarity: 'positive' as const }
    }
    expect(stingsOf(inGame(), inGame({ line: good }))).toEqual(['positive'])
    // A line that stays across the step — a re-render rather than an advance — must not re-chime.
    expect(stingsOf(inGame({ line: good }), inGame({ line: good }))).toEqual([])

    const bad = {
      speaker: '',
      text: 'Heart went down.',
      status: { marks: [], polarity: 'negative' as const }
    }
    expect(stingsOf(inGame(), inGame({ line: bad }))).toEqual(['negative'])

    const unmarked = {
      speaker: '',
      text: 'Brain went up by 1.',
      status: { marks: [{ start: 0, end: 5, tone: 'brain' as const }] }
    }
    expect(stingsOf(inGame(), inGame({ line: unmarked }))).toEqual([])
  })
})
