/**
 * The game's ends: what stops a playthrough, the prose that says so, and the modal that follows.
 * Each is an entry in {@link GAME_OVER_SCENES}. Two are conditions `gameOverReasonOf` tests; the
 * epilogue's own losing end is a button press the loop tests for itself.
 */

import { isGameOver } from './money'

/** Every way a playthrough can stop: the good one, and the one the epilogue loses to, included. */
export type GameOverReason = 'debt' | 'expulsion' | 'gameComplete' | 'endingDebt'

/** One ending: what plays, and what the modal at the end of it says. */
export interface GameOverScene {
  /** Narrator lines, played through the ordinary queue over a black screen. */
  lines: readonly string[]
  title: string
  message: string
}

export const GAME_OVER_SCENES: Record<GameOverReason, GameOverScene> = {
  debt: {
    lines: [
      'You run into them outside the Lowrise door. Or rather, they run into you.',
      'They\'re dressed in expensive suits and holding official looking papers. You remember them from the loan office.',
      'They calmly explain that you have a debt to pay and that your plans are off until they\'re settled.',
      'You brush them off, but find out quickly that your enrollment has been rescinded and terrible rumors are spreading about you on campus.',
      'With no choice, you start showing up for shifts at an isolated warehouse past the Veridan city limits.',
      'The 12-hour days melt your mind, and a rotating cast of shady characters check on you and the other workers from dawn til dusk.',
      'Somewhere back on campus, the semester goes on without you.'
    ],
    title: 'Game over',
    message:
      'Your university life is over. Your debt finally caught up to you. You can load an earlier save from the main menu.'
  },
  expulsion: {
    lines: [
      'You receive an email directly from the Dean of Students asking you to come to his office, which is never a good sign.',
      'He gets to the point: you\'re expelled. He explains that your recent behavior violated the university\'s code of conduct.',
      'He lets you argue for a bit before shooing you out.',
      'Campus security hovers over you as you pack your stuff, then drags you on a walk of shame to the campus gates.',
      'In less than an hour, you\'re waving farewell to Hades as the stone statue near the gates shrinks in the distance.',
      'Somewhere back on campus, the semester goes on without you.'
    ],
    title: 'Game over',
    message:
      'Your university life is over. You were expelled. You can load an earlier save from the main menu.'
  },
  gameComplete: {
    lines: [
      'You finally finish stuffing everything into your backpack and suitcase and head for the Loop.',
      'From the tram window, you take one last look back down the road at the gates, where the stone statue of Zeus is waving your farewell.',
      'As your flight takes off, you pick out the familiar buildings of Downtown, Stanchion, and the Promenade, thinking about all the memories you made this semester.',
      'You smile as you realize how when you first arrived, you were a stranger to all the friends you made. Now, you\'ll never forget them.',
      'You can\'t wait until next semester.'
    ],
    title: 'Thanks for playing!',
    message:
      'Your university life is over... until next semester. Congratulations on making it to the end of the game! If an ending CG was generated for you, I\'d love it if you would email me it! I\'ll take it as proof you finished the game and will add you to the credits as a special thank you.'
  },
  endingDebt: {
    lines: [
      'You run into them outside the Lowrise door. Or rather, they run into you.',
      'They\'re dressed in expensive suits and holding official looking papers. You remember them from the loan office.',
      'They calmly explain that you have a debt to pay and that you\'re not going home until they\'re settled.',
      'You brush them off, but find out quickly that your enrollment has been rescinded and terrible rumors are spreading about you online.',
      'With no choice, you start showing up for shifts at an isolated warehouse past the Veridan city limits.',
      'The 12-hour days melt your mind, and a rotating cast of shady characters check on you and the other workers from dawn til dusk.'
    ],
    title: 'Game over',
    message:
      'Your university life is over. Your debt caught up with you at the very last moment. You can load an earlier save from the main menu.'
  }
}

/** Which *losing* ending, if any, applies right now — the one place those conditions are tested. */
export function gameOverReasonOf(state: {
  money: number
  expelled: boolean
}): GameOverReason | null {
  // Expulsion outranks debt, whose prose assumes he is still enrolled.
  if (state.expelled) return 'expulsion'
  if (isGameOver(state.money)) return 'debt'
  return null
}
