/** Grab bag id for {@link SEED_WORDS}. */
export const SEED_WORD_BAG = 'seedWords'

/** The inspiration-word pool. */
export const SEED_WORDS = [
  'alchemy', 'amber', 'anthem', 'apricot', 'arcade', 'aspen', 'atlas',
  'aurora', 'avalanche', 'azure', 'balcony', 'ballad', 'bamboo', 'banjo',
  'bazaar', 'beacon', 'bedlam', 'bergamot', 'bicycle', 'bioluminescence',
  'birdsong', 'biscuit', 'blueberry', 'bonfire', 'boomerang', 'bramble',
  'bubblegum', 'buoyancy', 'butterscotch', 'cactus', 'cadence', 'calligraphy',
  'camaraderie', 'candlelight', 'canopy', 'caramel', 'caricature',
  'cartography', 'cascade', 'cashmere', 'catapult', 'cedar', 'chandelier',
  'charisma', 'chartreuse', 'chiffon', 'chlorophyll', 'cinnamon',
  'circulation', 'citrus', 'clementine', 'clockwork', 'cloud', 'cobblestone',
  'comet', 'compass', 'confetti', 'constellation', 'cosmos', 'crescendo',
  'crescent', 'crystalline', 'daffodil', 'dandelion', 'daydream', 'dazzle',
  'deja-vu', 'dewdrop', 'diorama', 'dominoes', 'doodle', 'doohickey',
  'driftwood', 'dumpling', 'dynamo', 'eclair', 'eclipse', 'effervescence',
  'elderberry', 'elixir', 'ember', 'emerald', 'encore', 'epiphany', 'equinox',
  'escapade', 'espresso', 'eucalyptus', 'fable', 'falcon', 'fanfare',
  'feather', 'fiddle', 'filament', 'firefly', 'fizz', 'flamingo', 'flannel',
  'flotsam', 'flourish', 'fluorescent', 'folklore', 'fortune', 'fossil',
  'fractal', 'freckle', 'frosting', 'galaxy', 'gallivant', 'gambit',
  'garland', 'garnet', 'gazebo', 'geode', 'ginger', 'glacier', 'glimmer',
  'gold', 'gondola', 'gossamer', 'grapefruit', 'greenhouse', 'gumption',
  'gusto', 'halcyon', 'hammock', 'harmonica', 'hearth', 'helium', 'hibiscus',
  'hideaway', 'hijinks', 'honeycomb', 'horizon', 'hullabaloo', 'humanism',
  'hurricane', 'incandescent', 'indigo', 'inertia', 'inkwell', 'iridescent',
  'ivory', 'ivy', 'jackalope', 'jamboree', 'jasmine', 'jetlag', 'jovial',
  'jubilee', 'juniper', 'kaleidoscope', 'karaoke', 'kayak', 'kerfuffle',
  'kindling', 'kite', 'labyrinth', 'lagoon', 'lantern', 'lattice', 'lavender',
  'lemonade', 'levity', 'lichen', 'lighthouse', 'lilac', 'limelight',
  'locket', 'longitude', 'lullaby', 'lumen', 'luminous', 'macaroon',
  'magnolia', 'mandolin', 'marmalade', 'meadow', 'meridian', 'meteor',
  'midsummer', 'milkshake', 'mirage', 'mischief', 'momentum', 'monsoon',
  'moonstone', 'mosaic', 'moxie', 'mulberry', 'nautical', 'nebula', 'nectar',
  'nightingale', 'nomad', 'nostalgia', 'nougat', 'novelty', 'oasis', 'oboe',
  'obsidian', 'octave', 'odyssey', 'opal', 'orchard', 'origami', 'ottoman',
  'overture', 'panorama', 'papaya', 'parachute', 'paradox', 'parasol',
  'patina', 'peach', 'peculiar', 'pendulum', 'peppermint', 'periwinkle',
  'phosphorescence', 'pinwheel', 'pirouette', 'pistachio', 'plumage',
  'polaroid', 'polka-dot', 'pomegranate', 'popsicle', 'porcelain', 'prism',
  'quandary', 'quartz', 'quicksilver', 'quill', 'quixotic', 'raincheck',
  'rainstorm', 'rapport', 'ravioli', 'razzmatazz', 'reverie', 'rhubarb',
  'ricochet', 'riptide', 'rosemary', 'roulette', 'rucksack', 'saffron',
  'salamander', 'sandcastle', 'sarsaparilla', 'seltzer', 'serendipity',
  'sherbet', 'shindig', 'silhouette', 'skylark', 'slapstick', 'snickerdoodle',
  'solstice', 'sonata', 'spectacle', 'stardust', 'supernova', 'sycamore',
  'tambourine', 'tangent', 'tangerine', 'tapestry', 'tessellation', 'thicket',
  'thunderclap', 'tidepool', 'tinsel', 'trampoline', 'treehouse', 'trellis',
  'trolley', 'turquoise', 'ukulele', 'umami', 'undertow', 'vanilla', 'velvet',
  'vertigo', 'voyage', 'waffle', 'wanderlust', 'watermelon', 'whimsy',
  'whirligig', 'windmill', 'wisteria', 'xylophone', 'yodel', 'yonder',
  'zenith', 'zephyr', 'zeppelin', 'zest', 'verisimilitude', 'zeitgeist'
] as const

/** The prompt tail carrying the draw — one line, shared by every builder that uses one. */
export function seedWordBlock(word: string): string[] {
  return [
    `Let this word of the day inspire you: ${word}`
  ]
}
