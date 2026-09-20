import { formatMoney } from './money'
import { markedLine } from './statusMark'
import { hasTrait } from './traits'
import type { Character, CharMemory, SceneLine } from './types'

/**
 * The gift vocabulary: the shops the reader can buy from, every item in them, every
 * word said about one, and the verdict on how it landed.
 */

// ─── The categories a gift is judged by ────────────────────────────────────────

/** The closed vocabulary a gift is tagged with and a character states her taste in. */
export const GIFT_CATEGORIES = [
  'romantic',
  'cute',
  'luxury',
  'glamour',
  'cozy',
  'practical',
  'nerdy',
  'artsy',
  'treats',
  'edgy',
  'vintage',
  'novelty'
] as const

export type GiftCategory = (typeof GIFT_CATEGORIES)[number]

/** What each category covers — the model's only guide to picking them. */
export const GIFT_CATEGORY_DESCRIPTIONS: Readonly<Record<GiftCategory, string>> = {
  romantic: 'flowers, sweet gestures, sentimental keepsakes',
  cute: 'plushies, pastels, mascots, adorable little things',
  luxury: 'designer names, precious materials, conspicuous price tags',
  glamour: 'fashion, beauty, makeup, perfume, jewelry',
  cozy: 'home comfort — candles, plants, blankets, soft ambient things',
  practical: 'useful everyday objects',
  nerdy: 'games, comics, film, tech, collectibles, internet culture',
  artsy: 'art, music, design, prints, crafts, creative tools',
  treats: 'food and drink',
  edgy: 'dark, weird, scene, risqué',
  vintage: 'antiques, retro, secondhand, nostalgic',
  novelty: 'gag gifts, oddities, whimsical conversation pieces'
}

export function isGiftCategory(value: unknown): value is GiftCategory {
  return typeof value === 'string' && (GIFT_CATEGORIES as readonly string[]).includes(value)
}

/** What a character makes of gifts, per category. Both lists may be empty. */
export interface GiftPreferences {
  liked: GiftCategory[]
  disliked: GiftCategory[]
}

// ─── The shops ─────────────────────────────────────────────────────────────────

/** One storefront: the left pane of the shopping tab. */
export interface ShopDef {
  /** Stable id; what {@link ItemDef.shopId} points at. */
  id: string
  name: string
  /** Placeholder for the real storefront icon. */
  emoji: string
  /** One line under the name — what kind of place this is. */
  blurb: string
}

export const SHOPS: readonly ShopDef[] = [
  {
    id: 'vu_campus_store',
    name: 'VU Campus Store',
    emoji: '🎓',
    blurb: 'The official campus store of Venus University. All proceeds go to university programs.'
  },
  {
    id: 'veridan_delivery',
    name: 'Veridan Delivery',
    emoji: '🚚',
    blurb: 'Get the best of Veridan\'s locally produced products delivered straight to your door.'
  },
  {
    id: 'girltime',
    name: 'GirlTime',
    emoji: '🎀',
    blurb: 'It\'s GirlTime! Shop the trendiest and cutest products on the net.'
  },
  {
    id: 'luxurynow',
    name: 'LUXURYNOW',
    emoji: '💎',
    blurb: 'Official online store for LUXURYNOW.'
  },
  {
    id: 'merchmogul',
    name: 'MerchMogul',
    emoji: '🛍️',
    blurb: 'The one-stop-shop for limited-time and pop-culture merch.'
  }
]

/** The {@link ShopDef} with this id, or `undefined` for one that never existed. */
export function shopDefOf(shopId: string): ShopDef | undefined {
  return SHOPS.find((shop) => shop.id === shopId)
}

// ─── The catalog ───────────────────────────────────────────────────────────────

/** One thing the reader can buy and give away. Code, never save state. */
export interface ItemDef {
  /** Stable slug; what `OwnedItem.itemId` and `CharInfo.gifts` key off. */
  id: string
  /** The {@link ShopDef} that sells it. */
  shopId: string
  name: string
  /** Placeholder standing in for the real item icon. */
  emoji: string
  /** Dollars, deducted the moment Buy is pressed. */
  price: number
  /** The shop's own copy — on the card, and injected with the gift. */
  description: string
  /**
   * What kind of present this is: one tag or two, never on screen, and the whole of what
   * {@link giftReactionOf} weighs against her taste.
   */
  categories: [GiftCategory] | [GiftCategory, GiftCategory]
}

const SHOP_CATALOG: readonly ItemDef[] = [
  // ─── VU Campus Store ───────────────────────────────────────────────────────
  {
    id: 'concord_wishing_coin',
    shopId: 'vu_campus_store',
    name: 'Concord Fountain Wishing Coin',
    emoji: '🪙',
    price: 18,
    description: `Buy a bit of luck this semester with this solid brass wishing coin. Engraved with the VU crest on the front and the Concord Fountain on the back.`,
    categories: ['romantic', 'novelty']
  },
  {
    id: 'greenhouse_rose_bouquet',
    shopId: 'vu_campus_store',
    name: 'Whitman Greenhouse Rose Bouquet',
    emoji: '🌹',
    price: 45,
    description: `Two dozen long-stem roses cut the same morning in the Whitman Greenhouse, wrapped in kraft paper with a packet of preservative. Color may vary based on season.`,
    categories: ['romantic']
  },
  {
    id: 'greenhouse_orchid',
    shopId: 'vu_campus_store',
    name: 'Whitman Greenhouse Potted Orchid',
    emoji: '🪴',
    price: 70,
    description: `A greenhouse-raised phalaenopsis in full bloom, potted in a ceramic planter with drainage. Weekly watering and indirect light will keep it reblooming season after season. Care card included.`,
    categories: ['cozy']
  },
  {
    id: 'greenhouse_honey_candles',
    shopId: 'vu_campus_store',
    name: 'Whitman Greenhouse Honey & Beeswax Candle Set',
    emoji: '🕯️',
    price: 52,
    description: `Orchard honey from our Whitman hives, jarred alongside three hand-poured beeswax pillars. Clean, soot-free burn with a natural warm-honey scent, no added fragrance. Over 40 hours of burn time per candle.`,
    categories: ['cozy', 'romantic']
  },
  {
    id: 'greenhouse_pressed_wildflowers',
    shopId: 'vu_campus_store',
    name: 'Whitman Greenhouse Pressed Wildflowers',
    emoji: '🌼',
    price: 38,
    description: `Pressed wildflowers from the Whitman Greenhouse meadow beds in a 5 x 7 in. floating glass frame: forget-me-nots, Queen Anne's lace, buttercups, wild violets and yarrow. Each frame arranged by hand. Ships in a padded box.`,
    categories: ['artsy', 'romantic']
  },
  {
    id: 'vu_crest_bracelet',
    shopId: 'vu_campus_store',
    name: 'VU Crest Charm Bracelet',
    emoji: '📿',
    price: 85,
    description: `Memorialize your VU time in a sterling silver bracelet with an enameled VU crest charm. Adjustable from 6.5 to 8 in.`,
    categories: ['glamour', 'romantic']
  },
  {
    id: 'kendall_bookends',
    shopId: 'vu_campus_store',
    name: 'Kendall Library Antique Bookend Pair',
    emoji: '📚',
    price: 90,
    description: `Solid brass bookends in the style of the Kendall Library reading room. Total weight about 6 lb. Felt-backed to protect shelves.`,
    categories: ['nerdy', 'vintage']
  },
  {
    id: 'kendall_journal_pen',
    shopId: 'vu_campus_store',
    name: 'Kendall Library Leather Journal & Fountain Pen',
    emoji: '📓',
    price: 76,
    description: `Leather-bound journal with 240 pages of unlined cream stock, heavy enough to take fountain pen ink without bleed-through. Set includes a brass-nib fountain pen and a bottle of ink. Kendall Library crest debossed on the cover.`,
    categories: ['artsy', 'practical']
  },
  {
    id: 'murder_on_the_silk_river',
    shopId: 'vu_campus_store',
    name: '"Murder on the Silk River"',
    emoji: '📗',
    price: 18,
    description: `A premium hardcover edition of the 1910 mystery set on Veridan's mill floors, a student favorite in LIT 101. New illustrated pages and an introduction from the English department.`,
    categories: ['artsy']
  },
  {
    id: 'pino_cola_soda_crate',
    shopId: 'vu_campus_store',
    name: 'Pino-Cola Lounge Seasonal Soda Crate',
    emoji: '🥤',
    price: 32,
    description: `Twelve glass bottles of Pino-Cola's campus-exclusive seasonal flavors in a reusable wooden crate. This season: Cherry Concord and Green Apple Static.`,
    categories: ['treats', 'nerdy']
  },
  {
    id: 'carnivorous_plant_kit',
    shopId: 'vu_campus_store',
    name: 'Carnivorous Plant Starter Kit',
    emoji: '🌿',
    price: 29,
    description: `Greenhouse-grown venus flytrap in a 3 in. pot, with a bag of nutrient-free soil and a care card. Suitable for beginners.`,
    categories: ['novelty', 'nerdy']
  },
  {
    id: 'gold_crosses_rose_pin',
    shopId: 'vu_campus_store',
    name: '"Meet Me Where Gold Crosses Rose" Enamel Pin',
    emoji: '📍',
    price: 16,
    description: `Official collaboration with the hit film "Love Between Gods", shot right here on VU campus. Hard enamel on gold plating, 1.25 in., with a locking clutch back.`,
    categories: ['nerdy', 'romantic']
  },
  {
    id: 'thorne_student_recordings',
    shopId: 'vu_campus_store',
    name: 'Thorne Auditorium Student Sessions LP',
    emoji: '🎼',
    price: 30,
    description: `This year's student performances from the Thorne Auditorium stage on one 180 g LP. Proceeds go directly to the VU music department.`,
    categories: ['artsy']
  },
  {
    id: 'palaestra_gym_towels',
    shopId: 'vu_campus_store',
    name: 'Palaestra Performance Gym Towels',
    emoji: '🏃',
    price: 95,
    description: `Set of four ultra-soft, 100% cotton gym towels embroidered with the Palaestra logo. Quick-drying, with a snap loop for hanging on a bag or hook. Machine washable.`,
    categories: ['practical']
  },
  {
    id: 'palaestra_drink_set',
    shopId: 'vu_campus_store',
    name: 'Palaestra Protein & Energy Drink Set',
    emoji: '🏋️',
    price: 36,
    description: `A pack of VU-designed performance drinks stocked at the Palaestra weight room counter. Six protein shakes (chocolate and vanilla) and six energy drinks.`,
    categories: ['practical', 'treats']
  },
  {
    id: 'elysium_porch_lantern',
    shopId: 'vu_campus_store',
    name: 'Elysium Village Desk Lantern',
    emoji: '🏮',
    price: 110,
    description: `Brass desk lantern modeled on the hurricane lanterns on Elysium Village porches. Runs from a wall outlet or USB. Warm white bulb, dimmable.`,
    categories: ['cozy', 'artsy']
  },
  {
    id: 'lowrise_cookbook',
    shopId: 'vu_campus_store',
    name: 'Lowrise 3 Sunday Dinner Cookbook',
    emoji: '🍲',
    price: 26,
    description: `94 recipes for feeding large groups, collected from the student volunteers who cook the Lowrise 3 Sunday dinner. Spiral-bound in durable metal and a water-resistant hardcover.`,
    categories: ['treats', 'practical']
  },
  {
    id: 'bunnyboard_sticker_pack',
    shopId: 'vu_campus_store',
    name: 'Bunnyboard Sticker Pack',
    emoji: '😂',
    price: 12,
    description: `Twelve die-cut holographic stickers of Bunnyboard\'s unique emojis. Weatherproof vinyl. Perfect for water bottles and laptop lids.`,
    categories: ['cute', 'nerdy']
  },

  // ─── Veridan Delivery ──────────────────────────────────────────────────────
  {
    id: 'lotterdale_grab_bag',
    shopId: 'veridan_delivery',
    name: 'Lotterdale Mystery Grab Bag',
    emoji: '📦',
    price: 27,
    description: `Pay your Lotterdale tax with a mystery grab bag full of trinkets straight off the market floor. What's inside? Vinyl records, vintage toys, handmade mittens... who knows? All sales final.`,
    categories: ['novelty', 'vintage']
  },
  {
    id: 'lotterdale_vintage_locket',
    shopId: 'veridan_delivery',
    name: 'Lotterdale Vintage Locket',
    emoji: '💛',
    price: 58,
    description: `Gold-filled oval locket on an 18 in. chain, 1930s to 1950s, cleaned and fitted with a new clasp. Holds two photos. Light wear consistent with age.`,
    categories: ['romantic', 'vintage']
  },
  {
    id: 'freights_comic_longbox',
    shopId: 'veridan_delivery',
    name: 'Freights Vintage Comic Longbox',
    emoji: '📖',
    price: 110,
    description: `Full longbox of roughly 80 bagged and boarded back issues from Freights Books & Records, mostly 1970s and 80s independents. Unsorted. Condition may vary.`,
    categories: ['nerdy', 'vintage']
  },
  {
    id: 'lotterdale_occult_set',
    shopId: 'veridan_delivery',
    name: 'Lotterdale Occult Curio Set',
    emoji: '🔮',
    price: 68,
    description: `Enter the otherworldly with a hand-illustrated 78-card tarot deck, brass pendulum on a chain, and three scented candles. Packaged in a velvet drawstring bag and an engraved wooden box.`,
    categories: ['edgy']
  },
  {
    id: 'lotterdale_biker_jacket',
    shopId: 'veridan_delivery',
    name: 'Vintage Leather Biker Jacket',
    emoji: '🧥',
    price: 135,
    description: `1980s black leather motorcycle jacket sourced from a rediscovered warehouse. Condition like new.`,
    categories: ['edgy', 'vintage']
  },
  {
    id: 'taxidermy_squirrel_suit',
    shopId: 'veridan_delivery',
    name: 'Taxidermied Squirrel in a Tiny Suit',
    emoji: '🐿️',
    price: 65,
    description: `Professionally preserved eastern gray squirrel, 9 in. tall on a finished wooden base, dressed in a fitted three-piece suit. Ethically sourced. Fur intact, no shedding, no odor.`,
    categories: ['edgy', 'novelty']
  },
  {
    id: 'hand_crank_record_player',
    shopId: 'veridan_delivery',
    name: 'Refurbished Hand-Crank Record Player',
    emoji: '📻',
    price: 180,
    description: `Hand-crank gramophone that plays 78s with no power source. All parts polished and hand-tested by a technician before sale.`,
    categories: ['artsy', 'vintage']
  },
  {
    id: 'freights_vinyl_crate',
    shopId: 'veridan_delivery',
    name: 'Freights Vinyl Crate',
    emoji: '💿',
    price: 85,
    description: `Crate of 20 LPs pulled from the Freights back catalog, 1960s through 90s, all genres. All records guaranteed playable, but wear may vary.`,
    categories: ['artsy', 'vintage']
  },
  {
    id: 'vintage_toolbox',
    shopId: 'veridan_delivery',
    name: 'Vintage Toolbox & Hand Tool Set',
    emoji: '🧰',
    price: 125,
    description: `Surprise the DIY-er in your life with this steel cantilever toolbox from the 60s containing anything they might need: wrenches, drivers, pliers, ball-peen hammer, etc. Tools have survived decades in great condition and have been polished like new.`,
    categories: ['practical', 'vintage']
  },
  {
    id: 'ventriloquist_dummy',
    shopId: 'veridan_delivery',
    name: 'Enzo the Ventriloquist Dummy',
    emoji: '🎭',
    price: 58,
    description: `Hand-carved reproduction of Enzo, the ventriloquist dummy from the Veridan Circus. Wooden head with working jaw string, cloth body, about 30 in. seated.`,
    categories: ['novelty']
  },
  {
    id: 'antique_hand_mirror',
    shopId: 'veridan_delivery',
    name: 'Victorian Silver-Backed Hand Mirror',
    emoji: '🪞',
    price: 140,
    description: `Victorian silver-backed hand mirror with a repoussé floral pattern. Carved Cupid pattern on the back. Re-plated and repolished for sale.`,
    categories: ['vintage', 'glamour']
  },
  {
    id: 'springmart_ramen_pack',
    shopId: 'veridan_delivery',
    name: 'SpringMart Instant Ramen Variety 12-Pack',
    emoji: '🍜',
    price: 24,
    description: `Whip up a delicious dinner in under 3 minutes with a gourmet assortment of six Springmart exclusive flavors: Cajun, Teriyaki, Wasabi, Green Tea, Truffle, and Italian.`,
    categories: ['treats', 'practical']
  },
  {
    id: 'springmart_candy_tub',
    shopId: 'veridan_delivery',
    name: 'SpringMart Bulk Candy Tub',
    emoji: '🍬',
    price: 30,
    description: `Five pounds of SpringMart brand bulk candy in an easy-carrying plastic tub: sours, chocolates, gummies, taffy and more.`,
    categories: ['treats']
  },
  {
    id: 'springmart_box_wine',
    shopId: 'veridan_delivery',
    name: 'SpringMart House Red Box Wine (3 L)',
    emoji: '🍷',
    price: 14,
    description: `Four bottles of SpringMart brand red wine, 3 L box.`,
    categories: ['treats']
  },
  {
    id: 'springmart_slippers',
    shopId: 'veridan_delivery',
    name: 'SpringMart Fuzzy Slipper Set',
    emoji: '🧦',
    price: 28,
    description: `The classic SpringMart slippers that have been a local favorite since their 1990 release. Still Sherpa-lined with grippy rubber soles, one size fits most. Machine washable.`,
    categories: ['cozy', 'practical']
  },
  {
    id: 'green_hill_stargazing_blanket',
    shopId: 'veridan_delivery',
    name: 'Green Hill Park Stargazing Blanket',
    emoji: '🌌',
    price: 56,
    description: `Heavy wool picnic blanket with a water-resistant backing, printed with a constellation map of the night sky over Green Hill Park. 60 x 80 in. Rolls up with a carry strap.`,
    categories: ['romantic', 'cozy']
  },
  {
    id: 'bobbys_milkshake_glasses',
    shopId: 'veridan_delivery',
    name: "Bobby's Diner Milkshake Glass Set",
    emoji: '🥛',
    price: 42,
    description: `Set of four 16 oz fluted soda-fountain glasses in the style used at Bobby's Diner, printed with designs by local artists. Dishwasher safe.`,
    categories: ['vintage', 'cozy']
  },
  {
    id: 'reserve_bank_coffee_sampler',
    shopId: 'veridan_delivery',
    name: 'Reserve Bank Coffee Sampler',
    emoji: '☕',
    price: 48,
    description: `Four 8 oz bags of single-origin beans roasted at Reserve Bank Cafe, including the Getaway blend. Guaranteed fresh.`,
    categories: ['treats', 'cozy']
  },
  {
    id: 'reserve_bank_latte_art_kit',
    shopId: 'veridan_delivery',
    name: 'Reserve Bank Latte Art Kit',
    emoji: '🫗',
    price: 45,
    description: `Reserve Bank Cafe's home latte kit: a 12 oz steel frothing pitcher, latte art pen, six stencils and a bag of house espresso blend. Instruction cards cover hearts, rosettas and tulips.`,
    categories: ['artsy', 'treats']
  },
  {
    id: 'fast_eats_sauce_box',
    shopId: 'veridan_delivery',
    name: 'Fast Eats Secret Menu Sauce Box',
    emoji: '🍔',
    price: 19,
    description: `Eight bottled sauces from the secret menus of all five Fast Eats locations, including the Downtown flagship's Pancho Punch. 4 oz each.`,
    categories: ['novelty', 'treats']
  },
  {
    id: 'pier44_carousel_horse',
    shopId: 'veridan_delivery',
    name: 'Pier 44 Antique Carousel Paperweight',
    emoji: '🎠',
    price: 95,
    description: `Hand-painted resin paperweight from the 60s, modeled after Pier 44 carousel horses, 6 in. tall on a brass pole and wooden base. Gold leaf detailing.`,
    categories: ['vintage']
  },
  {
    id: 'pair_buds',
    shopId: 'veridan_delivery',
    name: 'Pair Buds Sharing Earbuds',
    emoji: '🎧',
    price: 78,
    description: `Wireless earbuds each designed to sit comfortably in either ear. A UV sanitizing cycle disinfects the buds while charging. 7 hours per charge, 28 with the case. Rose and slate.`,
    categories: ['practical', 'romantic']
  },
  {
    id: 'instant_camera_bundle',
    shopId: 'veridan_delivery',
    name: 'Instant Camera Bundle',
    emoji: '📸',
    price: 85,
    description: `Instant camera in cream with two film packs (20 shots), a wrist strap and a 40-pocket mini album. Auto exposure, selfie mirror, self-timer.`,
    categories: ['artsy', 'practical']
  },
  {
    id: 'star_projector',
    shopId: 'veridan_delivery',
    name: 'Star Projector',
    emoji: '🌠',
    price: 38,
    description: `Projects a star map onto the ceiling based on the sky over Green Hill Park, with settings for specific dates. Drift mode, adjustable brightness, 60-minute auto-off. USB powered.`,
    categories: ['nerdy', 'cozy']
  },

  // ─── GirlTime ──────────────────────────────────────────────────────────────
  {
    id: 'pastel_palace_macarons',
    shopId: 'girltime',
    name: 'Pastel Palace Limited Macaron Box',
    emoji: '🍪',
    price: 34,
    description: `Missed the drop? We got you! Get a box of those beautiful, creamy macarons in the limited-edition box. Flavors include: Rose, Lavender, Lemon, and Pistachio.`,
    categories: ['treats', 'cute']
  },
  {
    id: 'pastel_palace_truffles',
    shopId: 'girltime',
    name: 'Pastel Palace Rose Truffle Chocolate Box',
    emoji: '🍫',
    price: 58,
    description: `Twenty-four hand-rolled truffles in rose, raspberry, and salted caramel, nestled in a lacquered pink keepsake box with a ribbon on top. Small-batch, made with real cream, and almost too pretty to eat!`,
    categories: ['treats', 'romantic']
  },
  {
    id: 'duchess_octopus_plush',
    shopId: 'girltime',
    name: 'Duchess the Octopus Plush',
    emoji: '🐙',
    price: 38,
    description: `Meet Duchess! The Aquarium at Riverside's giant celebrity octopus as a 16 in. minky plush with eight weighted, huggable arms. Embroidered eyes, surface washable. Official Aquarium at Riverside collaboration.`,
    categories: ['cute']
  },
  {
    id: 'jellyfish_nightlight',
    shopId: 'girltime',
    name: 'Jellyfish Room Nightlight',
    emoji: '🪼',
    price: 44,
    description: `Bring the Aquarium's jellyfish room home! Soft blue and violet jellyfish drift across the ceiling on a slow loop. Two brightness settings and a 30-minute sleep timer. USB powered.`,
    categories: ['cozy', 'cute']
  },
  {
    id: 'cutetea_perfume_roller',
    shopId: 'girltime',
    name: 'CuteTea Boba Perfume Roller',
    emoji: '🧋',
    price: 28,
    description: `Your favorite drink, wearable! Brown sugar, steamed milk and a hint of jasmine in a 10 ml rollerball. Long-lasting and cruelty-free. Limited-edition CuteTea collaboration.`,
    categories: ['glamour', 'cute']
  },
  {
    id: 'confectionery_eyeshadow',
    shopId: 'girltime',
    name: 'Pastel Palace "Confectionery" Eyeshadow Palette',
    emoji: '🎨',
    price: 52,
    description: `Twelve gorgeous, soft-girl shades that will make you look absolutely delicious: Macaron Crumb, Frosting Swirl, and Cherry Glaze. Comes with a cute mirrored compact shaped like a petit four.`,
    categories: ['glamour', 'cute']
  },
  {
    id: 'cutetea_tea_tins',
    shopId: 'girltime',
    name: 'CuteTea Loose Leaf Tea Tin Collection',
    emoji: '🍵',
    price: 46,
    description: `Six of CuteTea's house blends in adorable stackable tins. Steeping times printed right on the lid, so you can brew it at home exactly the way they do!`,
    categories: ['treats', 'cozy']
  },
  {
    id: 'cutetea_mascot_plush',
    shopId: 'girltime',
    name: 'CuteTea Mascot Plush',
    emoji: '🧸',
    price: 26,
    description: `Say hi to Pearl! CuteTea's boba-cup mascot as a 10 in. super-soft plush with an embroidered smile and a swappable felt straw. Surface washable.`,
    categories: ['cute', 'novelty']
  },
  {
    id: 'cutetea_board_game',
    shopId: 'girltime',
    name: 'CuteTea Tea-Time Board Game (Pastel Edition)',
    emoji: '🎲',
    price: 40,
    description: `The official CuteTea board game in a pastel edition! Original card art and pastel game pieces. 2 to 6 players, ages 8 and up.`,
    categories: ['nerdy', 'cute']
  },
  {
    id: 'cutetea_pastel_markers',
    shopId: 'girltime',
    name: 'CuteTea Pastel Marker Set (48 Colors)',
    emoji: '🖍️',
    price: 36,
    description: `48 dual-tip markers (brush and fine) in CuteTea's pastel palette, each color named after a menu drink. Alcohol-based and blendable. Comes in a clear stand with Pearl on the lid, swatch card included!`,
    categories: ['artsy', 'cute']
  },
  {
    id: 'strawberry_lip_balm_trio',
    shopId: 'girltime',
    name: 'Pastel Palace Strawberry Lip Balm Trio',
    emoji: '💄',
    price: 24,
    description: `Three sheer tinted balms inspired by Pastel Palace's signature desserts, packed in petite frosted jars that fit in any pocket. Strawberry shortcake, matcha ice cream, and chocolate fondue.`,
    categories: ['glamour', 'cute']
  },
  {
    id: 'pearl_claw_clips',
    shopId: 'girltime',
    name: 'Pearl Claw Clip Set',
    emoji: '🪷',
    price: 14,
    description: `Four pastel acetate claw clips, each with a tiny Pearl charm on the hinge. Holds thick hair without snagging. Comes in a mini boba cup case!`,
    categories: ['glamour', 'cute']
  },
  {
    id: 'aquarium_snow_globe',
    shopId: 'girltime',
    name: 'Aquarium Glass Tunnel Snow Globe',
    emoji: '❄️',
    price: 36,
    description: `The Aquarium's glass tunnel in miniature: riverbed, kelp and a tiny Duchess in the corner! 4 in. globe on a weighted base. Official Aquarium at Riverside collaboration.`,
    categories: ['novelty', 'cute']
  },
  {
    id: 'duchess_umbrella',
    shopId: 'girltime',
    name: 'Duchess Octopus Umbrella',
    emoji: '☂️',
    price: 30,
    description: `Compact auto-open umbrella with Duchess's eight arms printed across the canopy and a little octopus on the handle. 42 in. span, windproof frame, fits in a tote. Officially licensed by the Aquarium at Riverside.`,
    categories: ['cute', 'practical']
  },
  {
    id: 'couple_plush_keychains',
    shopId: 'girltime',
    name: 'Duchess & Pearl Couple Keychain Set',
    emoji: '💕',
    price: 22,
    description: `One for you, one for them! Duchess and Pearl as 3 in. plush keychains that hold hands with a magnet when you bring them together. Aquarium at Riverside x CuteTea collab. Gift box included!`,
    categories: ['cute', 'romantic']
  },
  {
    id: 'sheet_mask_sleep_set',
    shopId: 'girltime',
    name: 'Sheet Mask & Sleep Set',
    emoji: '😴',
    price: 42,
    description: `Self-care set with ten hydrating sheet masks, a weighted silk sleep mask and a satin scrunchie that won't crease your hair. Treat yourself!`,
    categories: ['glamour', 'cozy']
  },
  {
    id: 'heatless_curl_set',
    shopId: 'girltime',
    name: 'Satin Heatless Curling Set',
    emoji: '🌀',
    price: 26,
    description: `Curls overnight with zero heat! Satin curling rod, two scrunchies and a satin bonnet in blush pink. Works on hair past chin length. Illustrated how-to card included. Back in stock!`,
    categories: ['glamour', 'practical']
  },
  {
    id: 'selkie_beach_set',
    shopId: 'girltime',
    name: 'Selkie Beach Heart Sunglasses & Tote Set',
    emoji: '🕶️',
    price: 32,
    description: `Oversized heart sunglasses (UV400) in pink or white, a canvas tote printed with the Silky Way sign and a mini sunscreen. Everything for a day at Selkie Beach!`,
    categories: ['glamour', 'cute']
  },
  {
    id: 'future_cinema_poster_set',
    shopId: 'girltime',
    name: 'Future Cinema Classic Film Poster Set',
    emoji: '🎞️',
    price: 46,
    description: `Get artsy vibes in your room with official reprints from Future Cinema's romance classics rotation! Printed on matte archival stock and frame-ready at standard 18x24.`,
    categories: ['nerdy', 'artsy']
  },

  // ─── LUXURYNOW ─────────────────────────────────────────────────────────────
  {
    id: 'riverside_tennis_bracelet',
    shopId: 'luxurynow',
    name: 'Riverside Diamond Tennis Bracelet',
    emoji: '💎',
    price: 420,
    description: `Round brilliant diamonds set in 14k white gold, approximately 3.0 carats total weight. 7 in., double-locking clasp.`,
    categories: ['luxury']
  },
  {
    id: 'promenade_pearl_earrings',
    shopId: 'luxurynow',
    name: 'Promenade Pearl Drop Earrings',
    emoji: '🦪',
    price: 115,
    description: `Drop earrings of 11 mm South Sea pearls with high natural luster on 18k white gold hooks.`,
    categories: ['luxury', 'glamour']
  },
  {
    id: 'emerald_cocktail_ring',
    shopId: 'luxurynow',
    name: 'Emerald Cocktail Ring',
    emoji: '💍',
    price: 340,
    description: `4.1 carat Colombian emerald in a heavy yellow gold setting. Part of our vintage collection.`,
    categories: ['luxury', 'vintage']
  },
  {
    id: 'riverside_promise_ring',
    shopId: 'luxurynow',
    name: 'Riverside Rose Gold Promise Ring',
    emoji: '💍',
    price: 260,
    description: `14k rose gold band with a 0.25 ct round diamond in a bezel setting. "Promise" engraved inside the band.`,
    categories: ['luxury', 'romantic']
  },
  {
    id: 'lumiere_perfume',
    shopId: 'luxurynow',
    name: 'Lumiere Signature Eau de Parfum',
    emoji: '🌸',
    price: 250,
    description: `Limited partnership with Lumiere Fusion. Ripe fig, dark honey, smoke. Warm, unusual and strong. Eau de parfum, 50 ml.`,
    categories: ['luxury', 'glamour']
  },
  {
    id: 'silk_river_perfume',
    shopId: 'luxurynow',
    name: 'Silk River Eau de Parfum by Promenade Atelier',
    emoji: '🫧',
    price: 310,
    description: `Cold water over stone: iris and river reed, sheer and grey at first, settling close to the skin. Hand-blown bottle with a wax seal.`,
    categories: ['luxury', 'glamour']
  },
  {
    id: 'chateau_bordeaux_1998',
    shopId: 'luxurynow',
    name: 'Château Reserve Bordeaux, 1998',
    emoji: '🍷',
    price: 480,
    description: `Left-bank Bordeaux from Lumiere's 1998 vintage collection. Cassis, cedar and tobacco leaf.`,
    categories: ['luxury', 'treats']
  },
  {
    id: 'promenade_champagne_magnum',
    shopId: 'luxurynow',
    name: 'Vintage Brut Champagne Magnum',
    emoji: '🍾',
    price: 280,
    description: `1.5 L magnum of vintage brut in a mirrored presentation case. Fine, persistent bead; brioche and citrus on the nose.`,
    categories: ['luxury', 'treats']
  },
  {
    id: 'lumiere_chocolate_collection',
    shopId: 'luxurynow',
    name: 'Lumiere Grand Cru Chocolate Collection',
    emoji: '🍬',
    price: 265,
    description: `Thirty-six single-origin chocolates tempered by hand in Lumiere's kitchen, with a provenance card mapping each piece: Madagascar, Chuao, Tanzania. Lacquered box.`,
    categories: ['luxury', 'treats']
  },
  {
    id: 'riverside_leather_handbag',
    shopId: 'luxurynow',
    name: 'Riverside Flagship Leather Handbag',
    emoji: '👜',
    price: 420,
    description: `Soft-structure handbag in full-grain calfskin over a reinforced frame, with palladium hardware and a suede-lined interior. 12 x 9 x 5 in. Comes with a dust bag.`,
    categories: ['luxury', 'glamour']
  },
  {
    id: 'cashmere_wrap_coat',
    shopId: 'luxurynow',
    name: 'Cashmere Wrap Coat',
    emoji: '🧥',
    price: 890,
    description: `Floor-length wrap coat in undyed Grade-A Mongolian cashmere with a self-tie belt and no buttons.`,
    categories: ['luxury', 'cozy']
  },
  {
    id: 'rolux_eternal_watch',
    shopId: 'luxurynow',
    name: 'Rolux Eternal Automatic Watch',
    emoji: '⌚',
    price: 1200,
    description: `36 mm stainless steel case with sapphire crystal and in-house self-winding movement, 70-hour power reserve. Water resistant to 100 m. Steel bracelet with concealed clasp. Five-year international warranty.`,
    categories: ['luxury', 'practical']
  },
  {
    id: 'threads_sculpture_miniature',
    shopId: 'luxurynow',
    name: '"Threads" Desk Sculpture',
    emoji: '🗿',
    price: 370,
    description: `The Riverside Mall atrium sculpture "Threads" at 1:80 scale in brushed steel and suspended wire, 12 in. tall on a weighted marble base. Individually numbered. Licensed by Riverside Mall.`,
    categories: ['luxury', 'artsy']
  },
  {
    id: 'apogee_decanter',
    shopId: 'luxurynow',
    name: 'Club Apogee Bottle Service Decanter',
    emoji: '🥃',
    price: 290,
    description: `Hand-cut lead crystal decanter etched with a relief of the Club Apogee interior, normally reserved for the club's VIP bottle service. 1.2 L, ground-glass stopper.`,
    categories: ['luxury', 'edgy']
  },
  {
    id: 'girl_at_window_print',
    shopId: 'luxurynow',
    name: '"Girl at the Window" Framed Wall Print',
    emoji: '🖼️',
    price: 210,
    description: `A framed 8x12 wall print of Veridan's iconic masterpiece in a high-quality frame. Veridan museum logo lettered in gold.`,
    categories: ['artsy']
  },
  {
    id: 'museum_silk_scarf',
    shopId: 'luxurynow',
    name: '"Girl at the Window" Silk Scarf',
    emoji: '🧣',
    price: 190,
    description: `Silk twill scarf printed with the window detail from Girl at the Window. 35 x 35 in., hand-rolled hem. Made in Italy.`,
    categories: ['artsy', 'glamour']
  },
  {
    id: 'riverside_makeup_vault',
    shopId: 'luxurynow',
    name: 'Riverside Mall Full-Glam Makeup Vault',
    emoji: '💋',
    price: 360,
    description: `Professional makeup kit in a lacquered case: foundation, concealer, a 28-shade eyeshadow palette, six lipsticks, a brush set and a lighted mirror in the lid. Refillable pans.`,
    categories: ['glamour']
  },
  {
    id: 'museum_artbook',
    shopId: 'luxurynow',
    name: 'Veridan Museum Artbook',
    emoji: '📖',
    price: 180,
    description: `Hardcover, wide-print reference book of Veridan Museum pieces printed on non-tear, matte paper.`,
    categories: ['artsy', 'nerdy']
  },
  {
    id: 'diamond_necklace',
    shopId: 'luxurynow',
    name: 'Queen Anne Diamond Necklace',
    emoji: '💠',
    price: 1400,
    description: `Hand-cut diamonds set in platinum, approximately 5.2 carats total weight. 16 in. chain with a concealed clasp.`,
    categories: ['luxury', 'romantic']
  },
  {
    id: 'veridan_lingerie_set',
    shopId: 'luxurynow',
    name: 'Veridan\'s Secret Lingerie Set',
    emoji: '👙',
    price: 170,
    description: `Effortless elegance in plush velvet and detailed lace. Hand-stitched in boutique.`,
    categories: ['edgy', 'glamour']
  },

  // ─── MerchMogul ────────────────────────────────────────────────────────────
  {
    id: 'pacman_ghost_plush',
    shopId: 'merchmogul',
    name: 'Giant Stuffed Pac-Man Ghost (BTB Arcade Grand Prize)',
    emoji: '👻',
    price: 75,
    description: `BTB Arcade's top-shelf redemption prize, 4 ft tall. Still in the original packaging with the tag attached.`,
    categories: ['nerdy', 'cute']
  },
  {
    id: 'paradiso_soundtrack_cd',
    shopId: 'merchmogul',
    name: 'PARADISO Limited Soundtrack CDs',
    emoji: '💿',
    price: 130,
    description: `PARADISO limited OST CD edition, sold out at BTB in under a day and back in stock only on MerchMogul. Sealed and in perfect condition.`,
    categories: ['artsy', 'nerdy']
  },
  {
    id: 'btb_retro_console',
    shopId: 'merchmogul',
    name: 'BTB Retro Console Bundle',
    emoji: '🕹️',
    price: 240,
    description: `Working 80s NON-TENDO console with 6 cartridges from BTB's storage warehouse. Includes two controllers and the original RF adapter. Light use.`,
    categories: ['nerdy']
  },
  {
    id: 'btb_mechanical_keyboard',
    shopId: 'merchmogul',
    name: 'BTB Arcade Mechanical Keyboard',
    emoji: '⌨️',
    price: 120,
    description: `Licensed BTB Arcade keyboard, 75% layout, keycaps in the cabinet colors, clicky switches rated to 50 million presses. Wired or wireless, hot-swappable.`,
    categories: ['nerdy', 'practical']
  },
  {
    id: 'paradiso_dance_pad',
    shopId: 'merchmogul',
    name: 'PARADISO Home Dance Pad (Official)',
    emoji: '🕺',
    price: 95,
    description: `Official folding dance pad for PARADISO Online. Arcade-grade pressure sensors and dimensions matching the cabinet version. USB, compatible with both console and PC versions.`,
    categories: ['nerdy', 'practical']
  },
  {
    id: 'stalestein_bootleg_tee',
    shopId: 'merchmogul',
    name: '"The Murderers" Stalestein Concert T-Shirt',
    emoji: '👕',
    price: 48,
    description: `Official tee sold at the legendary, limited-entry "The Murderers" concert at Stalestein in 1989. Light fading on the graphic.`,
    categories: ['edgy', 'artsy']
  },
  {
    id: 'stalestein_pin_set',
    shopId: 'merchmogul',
    name: 'Stalestein Pin Set',
    emoji: '📌',
    price: 29,
    description: `15 pins from beloved Stalestein comedy and indie music groups. Includes three designs exclusive to this set.`,
    categories: ['edgy', 'artsy']
  },
  {
    id: 'stalestein_pocket_knife',
    shopId: 'merchmogul',
    name: 'Stalestein Multi-Utility Pocket Knife',
    emoji: '🔪',
    price: 80,
    description: `Stalestein-licensed multi-purpose knife designed by bar-regular "Shanks Dickton". Includes a can opener, a utility knife, a corkscrew, and more.`,
    categories: ['edgy', 'practical']
  },
  {
    id: 'stalestein_house_lager',
    shopId: 'merchmogul',
    name: 'Stalestein House Lager 6-Pack',
    emoji: '🍺',
    price: 18,
    description: `Stalestein's house lager in six 16 oz cans. Three flavors: Dark, Dry, and Twisted.`,
    categories: ['edgy', 'treats']
  },
  {
    id: 'horror_posters',
    shopId: 'merchmogul',
    name: 'Future Cinema Edgy Classics Posters',
    emoji: '🎬',
    price: 80,
    description: `Set of four limited posters distributed at Future Cinema Edgy Classics showings: "Silence of the Cows", "The Shindig", "Oldman", "Jujumaki".`,
    categories: ['artsy', 'edgy']
  },
  {
    id: 'resold_designer_earrings',
    shopId: 'merchmogul',
    name: 'Lotterdale 80s Designer Earrings',
    emoji: '✨',
    price: 320,
    description: `Hand-smithed designer gold-hoop earrings wildly popular in the 1980s, rediscovered in a Lotterdale warehouse.`,
    categories: ['glamour', 'vintage']
  },
  {
    id: 'dreams_massage_oil',
    shopId: 'merchmogul',
    name: 'Hotel DREAMS Massage Oil',
    emoji: '🧴',
    price: 26,
    description: `Sensual massage oil from Hotel DREAMS. Sealed and unopened, repackaged in a gift box. Scent is Midnight Stanchion: warm amber. 4 oz.`,
    categories: ['edgy', 'novelty']
  },
  {
    id: 'dreams_room_robe',
    shopId: 'merchmogul',
    name: 'Hotel DREAMS Themed Room Robe',
    emoji: '🛁',
    price: 68,
    description: `Heavyweight plush robe cut to be both sexy and comfortable. Embroidered logo on the chest, one size. Laundered before shipping, no stains.`,
    categories: ['cozy', 'novelty']
  },
  {
    id: 'dreams_late_checkout_set',
    shopId: 'merchmogul',
    name: 'Hotel DREAMS Aphrodisiac Set',
    emoji: '🔥',
    price: 40,
    description: `Hotel DREAMS official nightstand aphrodisiac kit. 2 oz bottle of herbal tincture (damiana, maca, ginseng), a warm-honey massage candle that melts into oil, and a satin blindfold.`,
    categories: ['edgy', 'romantic']
  },
  {
    id: 'duchess_temp_tattoos',
    shopId: 'merchmogul',
    name: 'Aquarium Temp Tattoo Sheet',
    emoji: '✒️',
    price: 15,
    description: `Aquarium at Riverside temp tattoos, including cute, sparkly images of Duchess, jellyfish, and more. 24 per sheet. Skin-safe, lasts about four days.`,
    categories: ['novelty', 'cute']
  },
  {
    id: 'btb_controller',
    shopId: 'merchmogul',
    name: 'BTB Princess Controller',
    emoji: '🎮',
    price: 58,
    description: `USB controller from BTB's limited Princess peripherals line, in Candy Pink. Wired and wireless modes, compatible with both PCs and consoles.`,
    categories: ['cute', 'nerdy']
  },
  {
    id: 'pastel_collectible',
    shopId: 'merchmogul',
    name: 'PUNKO Pop Pearl Figure',
    emoji: '🪆',
    price: 28,
    description: `Limited collectible PUNKO Pop figurine depicting CuteTea's boba-tea mascot Pearl. 4 in. tall.`,
    categories: ['cute', 'nerdy']
  },
  {
    id: 'future_cinema_reel_lamp',
    shopId: 'merchmogul',
    name: 'Future Cinema Reel Canister Lamp',
    emoji: '💡',
    price: 88,
    description: `Real 35 mm film canister from Future Cinema's old projection booth, rewired as a table lamp. Standard bulb, 6 ft cord with inline switch.`,
    categories: ['nerdy', 'practical']
  },
  {
    id: 'drowning_bell_box_set',
    shopId: 'merchmogul',
    name: 'Drowning Bell Vol. 1-12 Box Set',
    emoji: '🔔',
    price: 110,
    description: `All twelve volumes of Ryo Amagai's out-of-print horror manga about a mysterious river town, in the original English slipcase. Slight use, almost perfect condition.`,
    categories: ['edgy', 'nerdy']
  },
  {
    id: 'museum_art_supply_lot',
    shopId: 'merchmogul',
    name: 'Veridan Museum Art Supply Kit',
    emoji: '🖌️',
    price: 72,
    description: `Official Veridan Museum art supplies: professional-grade gouache set, six brushes, and a 20-sheet cold-press pad.`,
    categories: ['artsy']
  },
  {
    id: 'museum_print_set',
    shopId: 'merchmogul',
    name: 'Veridan Museum Vintage Print Set',
    emoji: '🗾',
    price: 48,
    description: `Eight exhibition prints from the Veridan Museum gift shop warehouse at a steeply discounted price. Archival stock, no creases, shipped flat between boards. All prints guaranteed pre-21st century, and contents vary.`,
    categories: ['artsy', 'vintage']
  }
]

/** The {@link ItemDef} with this id, or `undefined` for a save naming one that no longer exists. */
export function itemDefOf(itemId: string): ItemDef | undefined {
  return SHOP_CATALOG.find((item) => item.id === itemId)
}

/** Everything one shop sells, in catalog order — the shopping tab's right pane. */
export function itemsInShop(shopId: string): ItemDef[] {
  return SHOP_CATALOG.filter((item) => item.shopId === shopId)
}

// ─── How a gift lands ──────────────────────────────────────────────────────────

/** The app's verdict on one handover, decided at gift time and never re-judged. */
export type GiftReaction = 'loved' | 'liked' | 'neutral' | 'unimpressed'

/** The price a present must reach to please a `Materialist` at all, in dollars. */
export const MATERIALIST_PRICE_FLOOR = 100

/** Whether this present lands, and how hard — decided once, at gift time. */
export function giftReactionOf(
  item: ItemDef,
  character: Pick<Character, 'giftPreferences' | 'traits'> | undefined,
  repeat: boolean
): GiftReaction {
  // A repeat is judged ahead of her taste and a `Materialist`'s price tag alike.
  if (repeat) return 'unimpressed'

  const prefs = character?.giftPreferences
  const liked = item.categories.filter((cat) => prefs?.liked.includes(cat)).length
  const disliked = item.categories.some((cat) => prefs?.disliked.includes(cat))

  if (hasTrait(character, 'Materialist')) {
    if (item.price >= MATERIALIST_PRICE_FLOOR) {
      return liked === item.categories.length ? 'loved' : 'liked'
    }
    return liked > 0 ? 'neutral' : 'unimpressed'
  }

  if (liked === item.categories.length) return 'loved'
  if (liked > 0) return 'liked'
  return disliked ? 'unimpressed' : 'neutral'
}

/** How the handover is reported to the player and to RITA, one sentence per verdict. */
function giftReactionLine(firstName: string, reaction: GiftReaction): string {
  switch (reaction) {
    case 'loved':
      return `${firstName} really loves it!`
    case 'liked':
      return `${firstName} likes it.`
    case 'neutral':
      return `It's not ${firstName}'s usual thing, but she still appreciates it.`
    case 'unimpressed':
      return `${firstName} isn't very impressed...`
  }
}

/**
 * How the handover is reported at the scene's end, after her memories — with the verdict
 * marked where she was pleased, the two that went nowhere saying so in plain ink.
 */
export function giftStatusMarkedLine(firstName: string, reaction: GiftReaction): SceneLine {
  switch (reaction) {
    case 'loved':
      return markedLine(`${firstName} seemed to `, 'really love', ' your gift!', 'gain')
    case 'liked':
      return markedLine(`${firstName} seemed to `, 'like', ' your gift.', 'gain')
    case 'neutral':
      return {
        speaker: '',
        text: `${firstName} appreciated the gift, but you feel like something else might have been better.`
      }
    case 'unimpressed':
      return { speaker: '', text: `${firstName} wasn't very impressed by your gift...` }
  }
}

// ─── What she remembers being given ────────────────────────────────────────────

/** How many presents a character carries a memory of; a `Materialist` keeps more. */
export const GIFT_MEMORY_CAP = 3
const GIFT_MEMORY_CAP_MATERIALIST = 5

/** The cap that applies to this character. */
export function giftMemoryCapFor(character: Character | undefined): number {
  return hasTrait(character, 'Materialist') ? GIFT_MEMORY_CAP_MATERIALIST : GIFT_MEMORY_CAP
}

/** What a gift she kept is remembered as — the `desc` grammar every memory uses. */
export function giftMemoryDesc(item: ItemDef): string {
  return `you gave her the ${item.name}`
}

/** File one gift memory, evicting to stay inside the cap. */
export function withGiftMemory(
  memories: readonly CharMemory[],
  entry: CharMemory,
  cap: number
): CharMemory[] {
  const next = [...memories, entry]
  while (next.length > cap) {
    const at = next.slice(0, -1).findIndex((memory) => memory.type === 'liked')
    next.splice(at === -1 ? 0 : at, 1)
  }
  return next
}

// ─── The words a gift is given in ──────────────────────────────────────────────

/** The action the Gift button submits on the player's behalf. */
export function giftActionLine(
  firstName: string,
  item: ItemDef,
  reaction: GiftReaction
): string {
  return `I give ${firstName} the ${item.name} that I bought for ${formatMoney(item.price)} before this scene. ${giftReactionLine(firstName, reaction)}`
}

/**
 * The paragraph a given gift injects into the lorebook for the rest of the scene,
 * through the `always` channel.
 */
export function giftLoreNote(
  firstName: string,
  item: ItemDef,
  repeat: boolean,
  reaction: GiftReaction
): string {
  const parts = [
    `The reader has just given ${firstName} a gift: the ${item.name}. ${item.description}`,
    giftReactionLine(firstName, reaction)
  ]
  if (repeat) parts.push(`The reader has already given ${firstName} this item before.`)
  return parts.join(' ')
}
