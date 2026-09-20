/**
 * Every word the store page's pictures show: scenes, texting thread and roster, in the trailer
 * runtime's own line shape `{ speaker, actions?, text, bg? }` — `actions` holds `show:<charKey>`
 * and `sprite:<charKey>,<emotion>`; a scene's first line carries its `bg` and `show:`.
 */

/**
 * The page's twelve: the source save's roster rewritten to the girls the trailer never shows. A
 * girl already on the roster is swapped for herself, which resets her to a fresh contact like
 * the rest, so every one of the twelve is on the phone and the map.
 */
export const swaps = [
  { out: '9469a290-fa5b-457b-bb27-6b5328958159', in: '79dd2743-3541-4172-9ac9-c42c485aa5cc' }, // Haylee → Celest
  { out: 'c672a659-85fd-461c-b482-1826f3eb3af8', in: '2be5803f-189a-4761-9163-68971af865d5' }, // Lia → Roxy
  { out: 'd215de4d-7f92-4f59-954f-1f2461144f2c', in: '4abe43e5-69c1-4222-909e-8f9176e40c76' }, // Lili → Maddy
  { out: '89ff5e67-3917-4027-ac77-46683ef94a8e', in: '64cc6750-ed21-4356-88c2-b125c41ed431' }, // April → Tulip
  { out: '3b1ac596-c4a4-43a7-8ad8-b6b2c4c3a55f', in: 'd28276a0-b509-4f82-9a13-4d1158436074' }, // Livvie → Isabelle
  { out: 'feac7482-3e72-4354-b690-3087c2cf041e', in: 'feac7482-3e72-4354-b690-3087c2cf041e' }, // Rosalie
  { out: 'cc737cd4-29a6-4a88-b27a-7bd4b804cd7c', in: 'cc737cd4-29a6-4a88-b27a-7bd4b804cd7c' }, // Sara
  { out: '29b3374b-0d3f-4687-9fc2-72c636a31fd3', in: '29b3374b-0d3f-4687-9fc2-72c636a31fd3' }, // Ana
  { out: 'c01eae18-ac0d-4234-bd7f-dd07a7dfaf4b', in: 'c01eae18-ac0d-4234-bd7f-dd07a7dfaf4b' }, // Winter
  { out: '328abb39-bc14-4523-bbd8-38a115766fb3', in: '328abb39-bc14-4523-bbd8-38a115766fb3' }, // Ginny
  { out: '9dbe17be-2ced-407f-8e77-7621cdbfe671', in: '9dbe17be-2ced-407f-8e77-7621cdbfe671' }, // Adrian
  { out: 'f5139e6e-9f8d-4f29-89f8-e93dee2ee8b6', in: 'f5139e6e-9f8d-4f29-89f8-e93dee2ee8b6' } // Ami
]

/** The names the swapped-in girls' fresh handles are built from. */
export const names = {
  '79dd2743-3541-4172-9ac9-c42c485aa5cc': ['Celest', 'Morokova'],
  '2be5803f-189a-4761-9163-68971af865d5': ['Roxy', 'Villeneuve'],
  '4abe43e5-69c1-4222-909e-8f9176e40c76': ['Maddy', 'Katherine'],
  '64cc6750-ed21-4356-88c2-b125c41ed431': ['Tulip', 'Sasaki'],
  'd28276a0-b509-4f82-9a13-4d1158436074': ['Isabelle', 'Carmen'],
  'feac7482-3e72-4354-b690-3087c2cf041e': ['Rosalie', 'Fontana'],
  'cc737cd4-29a6-4a88-b27a-7bd4b804cd7c': ['Sara', 'Connors'],
  '29b3374b-0d3f-4687-9fc2-72c636a31fd3': ['Ana', 'Fina'],
  'c01eae18-ac0d-4234-bd7f-dd07a7dfaf4b': ['Winter', 'Yang'],
  '328abb39-bc14-4523-bbd8-38a115766fb3': ['Ginny', 'Hadron'],
  '9dbe17be-2ced-407f-8e77-7621cdbfe671': ['Adrian', 'Cho'],
  'f5139e6e-9f8d-4f29-89f8-e93dee2ee8b6': ['Ami', 'Holloway']
}

/** The arcade at closing time: Ana on the claw machine, Celest holding her coat. */
const arcadeLines = [
  {
    speaker: '',
    bg: 'arcade',
    actions: ['show:ana_fina', 'sprite:ana_fina,happy', 'show:celest_morokova', 'sprite:celest_morokova,neutral'],
    text: 'The arcade is almost empty this late. Ana has been at the claw machine for twenty minutes, and Celest is holding her coat for her.'
  },
  {
    speaker: 'ana_fina',
    actions: ['sprite:ana_fina,happy'],
    text: "It's not luck, it's strategy. I've got the bunny in a fork. It just doesn't know it yet."
  },
  {
    speaker: 'celest_morokova',
    actions: ['sprite:celest_morokova,happy'],
    text: 'She said that ten coins ago. I think the bunny is winning.'
  },
  {
    speaker: '',
    actions: ['sprite:ana_fina,sad'],
    text: 'The claw drops the bunny an inch from the chute. Ana turns around with her last coin and holds it out to you.'
  },
  {
    speaker: 'ana_fina',
    actions: ['sprite:ana_fina,embarrassed'],
    text: 'Okay. Last one. You try, and if you win it, you have to give it to one of us.'
  }
]

/** What the claw machine turns into once he picks. */
const arcadeReplyLines = [
  {
    speaker: '',
    actions: ['sprite:ana_fina,surprised', 'sprite:celest_morokova,surprised'],
    text: 'You get it on the first try. The bunny drops into the chute and you hand it straight to Celest.'
  },
  {
    speaker: 'celest_morokova',
    actions: ['sprite:celest_morokova,embarrassed'],
    text: "Oh! For me? You didn't have to..."
  },
  {
    speaker: 'ana_fina',
    actions: ['sprite:ana_fina,angry'],
    text: 'Excuse me?! I did all the work! I softened it up for you!'
  },
  {
    speaker: '',
    actions: ['sprite:celest_morokova,happy', 'sprite:ana_fina,sad'],
    text: 'Celest hugs the bunny anyway. Ana sulks about it all the way out.'
  }
]

/** The diner past Pier 44, in case Begin hangout is pressed. */
const dinerLines = [
  {
    speaker: '',
    bg: 'fast_food',
    actions: ['show:sara_connors', 'sprite:sara_connors,happy'],
    text: 'The diner smells like coffee and syrup. Sara is already in a booth with two menus, one of them upside down.'
  },
  {
    speaker: 'sara_connors',
    actions: ['sprite:sara_connors,happy'],
    text: "I ordered for both of us. Don't look at me like that, you said you wanted to do something dumb."
  },
  {
    speaker: '',
    actions: ['sprite:sara_connors,surprised'],
    text: 'The pancakes are, in fact, as big as your head.'
  }
]

/** Ginny's bench in the lab, with Adrian keeping his distance. */
const labLines = [
  {
    speaker: '',
    bg: 'lab',
    actions: ['show:ginny_hadron', 'sprite:ginny_hadron,happy', 'show:adrian_cho', 'sprite:adrian_cho,neutral'],
    text: 'Ginny has three cups of something green lined up on the bench. Adrian is leaning on the door frame and not coming any closer.'
  },
  {
    speaker: 'ginny_hadron',
    actions: ['sprite:ginny_hadron,happy'],
    text: "Perfect, a fresh subject! Don't worry, the last one only had a headache. Mostly."
  },
  {
    speaker: 'adrian_cho',
    actions: ['sprite:adrian_cho,neutral'],
    text: "I already said no. She's been asking everyone who walks past since lunch."
  },
  {
    speaker: 'ginny_hadron',
    actions: ['sprite:ginny_hadron,surprised'],
    text: "It's for science! And for my grade. Mostly for my grade."
  }
]

/** What the lab turns into once he drinks it. */
const labReplyLines = [
  {
    speaker: '',
    actions: ['sprite:ginny_hadron,surprised', 'sprite:adrian_cho,surprised'],
    text: 'You pick up the middle cup and drink it before either of them can stop you.'
  },
  {
    speaker: 'adrian_cho',
    actions: ['sprite:adrian_cho,surprised'],
    text: 'Dude.'
  },
  {
    speaker: 'ginny_hadron',
    actions: ['sprite:ginny_hadron,happy'],
    text: 'I love him. Write down the time, Adrian!'
  }
]

/** The greenhouse in February, landing on Winter saying yes. */
const greenhouseLines = [
  {
    speaker: '',
    bg: 'greenhouse',
    actions: ['show:winter_yang', 'sprite:winter_yang,neutral'],
    text: 'The greenhouse is the warmest place on campus in February. Winter is reading on the bench by the orchids, the same as every Tuesday.'
  },
  {
    speaker: 'winter_yang',
    actions: ['sprite:winter_yang,neutral'],
    text: "You can sit. I'm not going to move my things for you, though."
  },
  {
    speaker: '',
    actions: ['sprite:winter_yang,surprised'],
    text: "You ask her out. She closes her book and doesn't say anything for a while."
  },
  {
    speaker: 'winter_yang',
    actions: ['sprite:winter_yang,embarrassed'],
    text: '...Yes. Fine. Yes. You can stop looking so surprised now.'
  }
]

/** The Corkscrew's queue at the theme park, three girls deep. */
const themeParkLines = [
  {
    speaker: '',
    bg: 'theme_park',
    actions: [
      'show:tulip_sasaki',
      'sprite:tulip_sasaki,happy',
      'show:maddy_katherine',
      'sprite:maddy_katherine,sad',
      'show:ami_holloway',
      'sprite:ami_holloway,neutral'
    ],
    text: 'The line for the Corkscrew is forty minutes long. Maddy has read the safety sign out loud twice.'
  },
  {
    speaker: 'maddy_katherine',
    actions: ['sprite:maddy_katherine,sad'],
    text: 'It says it may cause loss of consciousness! Who reads that and gets on anyway?'
  },
  {
    speaker: 'ami_holloway',
    actions: ['sprite:ami_holloway,happy'],
    text: "Me. You're sitting in the middle. I'll hold your glasses."
  },
  {
    speaker: 'tulip_sasaki',
    actions: ['sprite:tulip_sasaki,happy', 'sprite:maddy_katherine,surprised'],
    text: "And I'll hold Ami! Everybody holds somebody. That's the rule."
  }
]

/** The practice room with the storm on the windows and Roxy on the amp. */
const stormLines = [
  {
    speaker: '',
    bg: 'music_practice',
    actions: ['show:roxy_villeneuve', 'sprite:roxy_villeneuve,neutral'],
    text: 'The storm is rattling the practice room windows. Roxy is sitting on the amp with her boots up, watching it.'
  },
  {
    speaker: 'roxy_villeneuve',
    actions: ['sprite:roxy_villeneuve,happy'],
    text: 'Finally. Some weather with a point of view.'
  },
  {
    speaker: 'roxy_villeneuve',
    actions: ['sprite:roxy_villeneuve,happy'],
    text: "Sit down. It's better with the lights off."
  }
]

/** The weight room after hours, the set that moves his Body. */
const weightRoomLines = [
  {
    speaker: '',
    bg: 'weight_room',
    actions: ['show:ami_holloway', 'sprite:ami_holloway,neutral'],
    text: 'Ami has been spotting you for an hour without changing her expression once.'
  },
  {
    speaker: 'ami_holloway',
    actions: ['sprite:ami_holloway,happy'],
    text: "Okay, that's a new max. Rack it. You get one minute of being smug, then we do legs."
  }
]

export const beats = {
  /** The hero GIF: the typed turn and the wait for the reply. */
  arcade: {
    bg: 'arcade',
    time: 1,
    cast: ['ana_fina', 'celest_morokova'],
    lines: arcadeLines,
    action: 'Win it and give it to Celest.',
    reply: {
      lines: arcadeReplyLines,
      summary: 'The reader won a plushie at the arcade and gave it to Celest, which Ana pretended not to mind.'
    }
  },
  /** The texting GIF: a thread that turns into a plan. */
  texts: {
    charKey: 'sara_connors',
    time: 1,
    readerText: 'you still up? wanna do something dumb',
    replies: [
      'always',
      'theres a 24hr diner past pier 44, pancakes as big as your head',
      'meet me out front in 20!!'
    ],
    summary: 'Sara invited the reader out for late-night pancakes at a diner past Pier 44.',
    hangout: { description: 'The reader meets Sara for late-night pancakes at a diner past Pier 44.' },
    scene: {
      bg: 'fast_food',
      time: 1,
      cast: ['sara_connors'],
      lines: dinerLines,
      summary: 'The reader and Sara ate enormous pancakes at a diner past Pier 44 in the middle of the night.'
    }
  },
  /** Sidebar 1: the box with the action typed and both girls on stage. */
  lab: {
    bg: 'lab',
    time: 0,
    cast: ['ginny_hadron', 'adrian_cho'],
    lines: labLines,
    action: 'Volunteer for the experiment.',
    reply: {
      lines: labReplyLines,
      summary: "The reader drank one of Ginny's experiments in front of Adrian, and Ginny was delighted."
    }
  },
  /** Sidebar 2: the milestone sheet over the greenhouse. */
  greenhouse: {
    bg: 'greenhouse',
    time: 0,
    cast: ['winter_yang'],
    lines: greenhouseLines,
    memory: { type: 'loved', desc: 'you asked her out in the greenhouse and she said yes' },
    event: 'isLover',
    emotion: 'happy'
  },
  /** Sidebar 3: the trio in the queue. */
  themePark: {
    bg: 'theme_park',
    time: 0,
    cast: ['tulip_sasaki', 'maddy_katherine', 'ami_holloway'],
    lines: themeParkLines
  },
  /** Sidebar 4: the night storm on the practice room. */
  storm: {
    bg: 'music_practice',
    time: 1,
    weather: 'storm',
    cast: ['roxy_villeneuve'],
    lines: stormLines
  },
  /** Sidebar 5: the Body rank-up sheet over the weight room. */
  weightRoom: {
    bg: 'weight_room',
    time: 1,
    cast: ['ami_holloway'],
    lines: weightRoomLines,
    stat: 'body',
    before: { brain: 45, body: 50, heart: 40 },
    after: { brain: 45, body: 62, heart: 40 }
  }
}
