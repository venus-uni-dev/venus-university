import { describe, expect, it } from 'vitest'
import {
  acePerfectHeart,
  allScoresOf,
  brainFactor,
  examScore,
  fullDescriptionOf,
  gpaOf,
  gradePointsOf,
  gradedCourses,
  gradesStandingOf,
  kindOf,
  projectScore,
  projectWorkNeeded
} from '@shared/academics'
import { pointsForTier } from '@shared/playerStats'
import type { ClassEntry, ClassRecord } from '@shared/types'
import { classEntry, peClassEntry } from './fixtures'

/**
 * The academic layer's score arithmetic. Every number here ends up frozen on a save the
 * moment an exam is sat and is never recomputed, so a wrong answer is exactly
 * the plausible-but-unrepairable state the test suite exists to catch.
 */

describe('kindOf', () => {
  // A PE class never gets exams, even one a save wrote before the kind was
  // stripped from PE entries.
  it('reads PE as no kind at all, whatever the field says', () => {
    expect(kindOf({ ...peClassEntry(), kind: 'project' } as ClassEntry)).toBeNull()
  })
})

describe('brainFactor', () => {
  it('is 1 exactly at the required tier', () => {
    expect(brainFactor(pointsForTier(2), 2)).toBe(1)
  })

  it('is the fraction of the way there below it', () => {
    // Tier 3 opens at 35 points; half way there is half the Brain half.
    expect(brainFactor(pointsForTier(3) / 2, 3)).toBeCloseTo(0.5)
  })

  it('never divides by the tier-1 floor of zero', () => {
    expect(brainFactor(0, 1)).toBe(1)
  })

  it('floors at zero rather than going negative', () => {
    expect(brainFactor(-10, 3)).toBe(0)
  })
})

describe('examScore', () => {
  // Exactly the Brain a medium midterm asks for: half the grade bought, and the
  // paper left holding the other half.
  const base = {
    brain: pointsForTier(3),
    difficulty: 'medium',
    exam: 'midterm',
    skipped: 0
  } as const

  it('is a flat zero for an exam he did not sit, however clever he is', () => {
    expect(examScore({ ...base, present: false, correct: 3, asked: 3 })).toBe(0)
  })

  it('is 100 for a full Brain half and a perfect paper', () => {
    expect(examScore({ ...base, present: true, correct: 3, asked: 3 })).toBe(100)
  })

  it('is the Brain half alone when there was nothing to ask about', () => {
    expect(examScore({ ...base, present: true, correct: 0, asked: 0 })).toBe(50)
  })

  it('splits the quiz half by how many were right', () => {
    expect(examScore({ ...base, present: true, correct: 1, asked: 2 })).toBe(75)
  })

  // Each ditched factoid meeting is a question answered wrong.
  it('counts every skipped factoid meeting against the quiz half', () => {
    expect(examScore({ ...base, present: true, correct: 3, asked: 3, skipped: 3 })).toBe(75)
  })

  it('is the Brain half alone when every class was skipped', () => {
    expect(examScore({ ...base, present: true, correct: 0, asked: 0, skipped: 6 })).toBe(50)
  })

  // Brain past the tier the class asks squeezes the paper's half rather than
  // being thrown away, so the surplus covers a question he got wrong.
  it('pays for Brain past the tier the class asks', () => {
    const clever = { ...base, brain: pointsForTier(5), present: true } as const
    expect(examScore({ ...clever, correct: 1, asked: 2 })).toBe(95)
    expect(examScore({ ...clever, correct: 3, asked: 3 })).toBe(100)
  })

  it('never lets Brain alone account for more than ninety', () => {
    expect(examScore({ ...base, brain: 1000, present: true, correct: 0, asked: 0 })).toBe(90)
    expect(examScore({ ...base, brain: 1000, present: true, correct: 0, asked: 3 })).toBe(90)
  })

  // The other side of the same ceiling: the paper is worth half the grade at
  // most, so a reader with nothing tops out at fifty however well he answers.
  it('never lets the paper alone account for more than fifty', () => {
    expect(examScore({ ...base, brain: 0, present: true, correct: 3, asked: 3 })).toBe(50)
  })

  it('is never perfect with a question wrong or a class skipped, at any Brain', () => {
    for (const brain of [0, pointsForTier(3), pointsForTier(5), 1000]) {
      expect(examScore({ ...base, brain, present: true, correct: 2, asked: 3 })).toBeLessThan(100)
      expect(
        examScore({ ...base, brain, present: true, correct: 3, asked: 3, skipped: 1 })
      ).toBeLessThan(100)
    }
  })
})

describe('projectWorkNeeded', () => {
  it('is one session per meeting from assignment to showcase', () => {
    // Assigned week 1, shown week 4: weeks 1, 2 and 3 are the sessions.
    expect(projectWorkNeeded(3, 'medium')).toBe(3)
  })

  it('asks one fewer of an easy class and one more of a hard one', () => {
    expect(projectWorkNeeded(3, 'easy')).toBe(2)
    expect(projectWorkNeeded(3, 'hard')).toBe(4)
  })

  it('never falls below one, however short the run', () => {
    expect(projectWorkNeeded(1, 'easy')).toBe(1)
    expect(projectWorkNeeded(0, 'easy')).toBe(1)
  })
})

describe('projectScore', () => {
  const base = {
    brain: pointsForTier(5),
    difficulty: 'medium',
    exam: 'midterm',
    needed: 4
  } as const

  it('is zero for a showcase he did not turn up to', () => {
    expect(projectScore({ ...base, present: false, worked: 4, heart: 0 })).toBe(0)
  })

  it('is 100 for full Brain and a finished project, with no heart needed', () => {
    expect(projectScore({ ...base, present: true, worked: 4, heart: 0 })).toBe(100)
  })

  it('splits the second half by how much of the project got built', () => {
    expect(projectScore({ ...base, present: true, worked: 2, heart: 0 })).toBe(75)
  })

  // The bonus scales with the points themselves, not with the tier they buy, so
  // a point of Heart is worth something the day it is earned rather than only at
  // the threshold it crosses.
  it('scales the heart bonus by his points against the top tier', () => {
    // Halfway to the top of the scale is half of the 40 the bonus is worth,
    // claimed out of the half a project only half built left unspoken for.
    expect(projectScore({ ...base, present: true, worked: 2, heart: 50 })).toBe(85)
    expect(projectScore({ ...base, present: true, worked: 2, heart: pointsForTier(3) })).toBe(82)
  })

  it('clamps the bonus at the top tier rather than paying past it', () => {
    expect(projectScore({ ...base, present: true, worked: 0, heart: pointsForTier(5) })).toBe(90)
    expect(projectScore({ ...base, present: true, worked: 0, heart: 500 })).toBe(90)
  })

  it('is 100 for a finished project however much charm went into it', () => {
    expect(projectScore({ ...base, present: true, worked: 4, heart: pointsForTier(5) })).toBe(100)
  })

  // Heart is a share of the grade rather than a bonus on top of it, so charm
  // can top up a half-built showcase but never finish it.
  it('never lets Brain and Heart together carry an unfinished project', () => {
    const unfinished = { ...base, present: true, worked: 3 } as const
    expect(projectScore({ ...unfinished, heart: pointsForTier(5) })).toBeLessThan(100)
    expect(projectScore({ ...unfinished, brain: 1000, heart: 500 })).toBeLessThan(100)
  })
})

describe('acePerfectHeart', () => {
  it('pays more for a harder class', () => {
    expect(acePerfectHeart('easy')).toBe(2)
    expect(acePerfectHeart('medium')).toBe(3)
    expect(acePerfectHeart('hard')).toBe(4)
  })
})

describe('allScoresOf', () => {
  const records: Record<string, ClassRecord> = {
    'ART 101': { meetings: [], midtermScore: 100, finalScore: 40 },
    'BIO 210': { meetings: [], midtermScore: 100 },
    'CHM 300': { meetings: [] }
  }

  it('collects both assessments and skips the ones not yet sat', () => {
    expect(allScoresOf(records)).toEqual([100, 40, 100])
  })
})

describe('gradedCourses', () => {
  it('takes each course on the timetable once, and nothing PE or unknown', () => {
    const classes: Record<string, ClassEntry> = {
      'BIO 210': classEntry(),
      'PED 101': peClassEntry()
    }
    const schedule = { 0: 'BIO 210', 2: 'BIO 210', 4: 'PED 101', 6: 'ZZZ 999' }
    expect(gradedCourses(schedule, classes).map((entry) => entry.code)).toEqual(['BIO 210'])
  })
})

describe('gpaOf', () => {
  const bio = classEntry({ code: 'BIO 210' })
  const art = classEntry({ code: 'ART 101' })

  /** `attended` of `count` meetings, on dates nothing else reads. */
  function meetings(attended: number, count: number): ClassRecord['meetings'] {
    return Array.from({ length: count }, (_, i) => ({ date: i, attended: i < attended }))
  }

  it('is a clean 4.0 for a semester nothing has happened in yet', () => {
    expect(gpaOf({}, [])).toBe(4)
    expect(gpaOf({}, [bio])).toBe(4)
  })

  it('grades a class with no scores yet on attendance alone', () => {
    // Three of four meetings sat is 75%, which the scale reads as a C.
    expect(gpaOf({ 'BIO 210': { meetings: meetings(3, 4) } }, [bio])).toBe(2)
  })

  it('weighs the scores against attendance once a paper has been sat', () => {
    // 0.75 * 80 + 0.25 * 100 = 85.
    expect(gpaOf({ 'BIO 210': { meetings: meetings(4, 4), midtermScore: 80 } }, [bio])).toBe(3)
  })

  it('counts nothing for a class off the timetable, however full its record', () => {
    const records: Record<string, ClassRecord> = {
      'BIO 210': { meetings: meetings(4, 4), midtermScore: 80 },
      'ART 101': { meetings: meetings(0, 4) }
    }
    expect(gpaOf(records, [bio])).toBe(3)
    expect(gpaOf(records, [bio, art])).toBe(1.5)
  })
})

describe('gradePointsOf', () => {
  it('turns on the whole percent the cutoff names', () => {
    expect(gradePointsOf(93)).toBe(4)
    expect(gradePointsOf(92)).toBe(3.7)
    expect(gradePointsOf(60)).toBe(0.7)
    expect(gradePointsOf(59)).toBe(0)
  })
})

describe('fullDescriptionOf', () => {
  /**
   * The blurb is all a class stores, so every sentence a prompt reads about who
   * teaches it and how hard it is has to be assembled here, from the fields beside it.
   */
  it('says the blurb, then the professor, then the difficulty', () => {
    const entry = classEntry({ description: 'Cells.', difficulty: 'hard' })
    expect(fullDescriptionOf(entry)).toBe(
      "Cells. The class is taught by Professor Okafor. He's an older man with a strict personality. " +
        "It's a notoriously hard class."
    )
  })

  it('leaves a medium class nothing to be notorious for', () => {
    const said = fullDescriptionOf(classEntry({ difficulty: 'medium' }))
    expect(said).not.toContain('notoriously')
    expect(said).toContain('taught by Professor Okafor')
  })

  it('gives a PE class its coach and no difficulty at all', () => {
    expect(fullDescriptionOf(peClassEntry({ description: 'Running.' }))).toBe(
      "Running. The class is run by Coach Okafor. He's an older man with a strict personality."
    )
  })

  it('is the description itself when nothing was rolled worth saying', () => {
    // Never true of a generated class, but the join must not leave a trailing space.
    expect(fullDescriptionOf(classEntry({ description: 'Cells.' }))).toMatch(/[.]$/)
  })
})

describe('gradesStandingOf', () => {
  it('needs every score above 90, exclusive', () => {
    expect(gradesStandingOf([91, 100])).toBe('good')
    expect(gradesStandingOf([90, 100])).toBeNull()
  })

  it('needs every score below 50, exclusive', () => {
    expect(gradesStandingOf([49, 0])).toBe('bad')
    expect(gradesStandingOf([50, 0])).toBeNull()
  })

  it('is nothing at all with no scores, rather than vacuously both', () => {
    expect(gradesStandingOf([])).toBeNull()
  })
})
