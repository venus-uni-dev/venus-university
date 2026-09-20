import type { StatKey } from '@shared/playerStats'

/**
 * The stat-raising actions the slot-opening row suggests when the reader has nothing on.
 * Pure data, sent through the classifier as though he had typed it.
 */
export const STAT_ACTIONS: Record<StatKey, readonly string[]> = {
  brain: [
    'Improve Brain by reading in the Kendall Library.',
    'Improve Brain by reviewing in an Agora study pod.',
    'Improve Brain by sketching the paintings at the Veridan Museum.',
    'Improve Brain by practicing piano in a Thorne Auditorium practice room.',
    'Improve Brain by buying puzzle games for cheap at Lotterdale flea market.',
    'Improve Brain by getting a Nutro-Coffee at Reserve Bank Cafe.',
    'Improve Brain by learning about the plants in the Whitman Greenhouse.',
    'Improve Brain by learning about marine life at the Aquarium at Riverside.',
    'Improve Brain by playing board games at CuteTea.',
    'Improve Brain by watching a sci-fi movie at Future Cinema.',
    'Improve Brain by playing Wheel of Jeopardy at the BTB Arcade.',
    'Improve Brain by picking up some new books at Freights.',
    'Improve Brain by doing some open-air studying at Green Hill Park.',
    'Improve Brain by eating a special mussel dish at Lumiere Fusion.',
    'Improve Brain by watching documentaries at a Kendall Library terminal.',
    'Improve Brain by drinking a Ginkgo Milk Tea at CuteTea.',
    'Improve Brain by eating fish head soup at the Eastern Buffet.',
    'Improve Brain by playing chess at the Pino-Cola Lounge.',
    'Improve Brain by doing a VR escape room at the Riverside Mall.',
    "Improve Brain by ordering the Egghead Omelette at Bobby's Diner.",
  ],
  body: [
    'Improve Body by running laps on the Palaestra rooftop track.',
    'Improve Body by swimming laps in the Palaestra pool.',
    'Improve Body by hitting the weights in the Palaestra gym.',
    'Improve Body by playing PARADISO at the BTB Arcade.',
    'Improve Body by hiking through the hills at Green Hill Park.',
    'Improve Body by playing a pickup game on the Palaestra turf.',
    'Improve Body by playing laser tag at the Riverside Mall.',
    'Improve Body by playing tennis down at the Palaestra courts.',
    'Improve Body by hauling groceries home from SpringMart.',
    'Improve Body by swimming at Selkie Beach.',
    'Improve Body by jogging on the Pier 44 Boardwalk.',
    'Improve Body by playing ping pong at the Pino-Cola Lounge.',
    'Improve Body by dancing at Club Apogee.',
    'Improve Body by taking on the Big Burger challenge at Fast Eats.',
    'Improve Body by protein-loading at the Eastern Buffet.',
    'Improve Body by playing Knock-out Boxing at the BTB Arcade.',
    'Improve Body by playing basketball in a Palaestra gymnasium.',
    'Improve Body by doing pushups in the Lowrise 4 courtyard.',
    'Improve Body by drinking a fresh protein smoothie blended at SpringMart.',
    "Improve Body by ordering the Lumberjack Platter at Bobby's Diner.",
  ],
  heart: [
    'Improve Heart by braving the open mic at the Stalestein.',
    'Improve Heart by trying to pick up girls at Club Apogee.',
    'Improve Heart by volunteering to cook in the Lowrise 4 kitchen.',
    'Improve Heart by joining co-op games at the Pino-Cola rec center.',
    'Improve Heart by hanging out in the Lowrise 4 lounge.',
    "Improve Heart by chatting up the waitresses at Bobby's Diner.",
    'Improve Heart by watching a rom-com movie at Future Cinema.',
    'Improve Heart by joining a party in Elysium Village.',
    'Improve Heart by getting a sensual massage at Hotel DREAMS.',
    'Improve Heart by volunteering to pick up trash at Selkie Beach.',
    'Improve Heart by people-watching at the Venus Quad.',
    'Improve Heart by drinking the Charm Potion at Pastel Palace.',
    'Improve Heart by making a wish at the Concord Fountain.',
    'Improve Heart by hitting the spa at the Riverside Mall.',
    'Improve Heart by haggling at Lotterdale Market.',
    'Improve Heart by going to an SEB mixer at the Agora.',
    'Improve Heart by browsing romance novels at Freights.',
    'Improve Heart by getting the jellyfish\'s blessing at Aquarium at Riverside.',
    'Improve Heart by leaving a flower at Girl at the Window in the Veridan Museum.',
    'Improve Heart by singing in a Thorne Auditorium practice room.',
  ]
}

/** The grab bag id a stat's sentences are dealt from. */
export function statActionBag(stat: StatKey): string {
  return `statActions.${stat}`
}
