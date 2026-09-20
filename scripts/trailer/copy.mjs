/**
 * Every word the trailer shows: the captions and the beats the driver plays through. Each line is
 * `{ speaker, actions?, text, bg? }`: `speaker` is a charKey, `''` for narration or `'reader'` for
 * what he types; `actions` holds `show:`/`hide:<charKey>`, `sprite:<charKey>,<emotion>` (optionally
 * suffixed `_pe`, `_swim` or `_nude`) and `cg:<position>`.
 */

export const captions = {
  intro: 'A dating sim where...',
  anything: { lead: 'You can say or do', big: 'ANYTHING' }
}

/** The quad: April and Gwen working on him and on each other, up to the question. */
const duoDayLines = [
  {
    speaker: '',
    bg: 'quad',
    actions: [
      'show:april_valentine',
      'sprite:april_valentine,happy',
      'show:gwen_haewon',
      'sprite:gwen_haewon,angry'
    ],
    text: 'You walk past the fountain and straight into an argument. April waves you over. Gwen looks like she\'d rather you kept walking.'
  },
  {
    speaker: 'april_valentine',
    actions: ['sprite:gwen_haewon,embarrassed'],
    text: 'Cinnamon sugar! Perfect timing. Tell her I\'m allowed to sit on the fountain.'
  },
  {
    speaker: 'gwen_haewon',
    actions: ['sprite:april_valentine,surprised'],
    text: 'He\'s not telling you anything. He was walking past. It\'s a road.'
  },
  {
    speaker: '',
    actions: ['sprite:april_valentine,happy', 'sprite:gwen_haewon,angry'],
    text: 'April grabs your arm and pulls you down next to her. Gwen stares at her hand on your arm.'
  },
  {
    speaker: 'april_valentine',
    actions: ['sprite:gwen_haewon,embarrassed'],
    text: 'Aw, Gwennie, you can look all you want.'
  },
  {
    speaker: 'gwen_haewon',
    actions: ['sprite:april_valentine,angry'],
    text: 'I ran eight miles this morning and he watched me finish. What have you done today?'
  },
  {
    speaker: '',
    actions: ['sprite:april_valentine,happy', 'sprite:gwen_haewon,surprised'],
    text: 'They both go quiet and look at you.'
  },
  {
    speaker: 'gwen_haewon',
    actions: ['sprite:gwen_haewon,angry'],
    text: 'Fine. Say it in front of both of us. Which one of us is it?'
  }
]

/** What the quad turns into once he refuses to pick. */
const duoDayReplyLines = [
  {
    speaker: '',
    actions: ['sprite:april_valentine,surprised', 'sprite:gwen_haewon,surprised'],
    text: 'You say it. Both of you. Nobody says anything for a second.'
  },
  {
    speaker: 'april_valentine',
    actions: ['sprite:april_valentine,happy'],
    text: 'Wait, say that again? I want to hear it one more time.'
  },
  {
    speaker: 'gwen_haewon',
    actions: ['sprite:gwen_haewon,angry'],
    text: 'That\'s not an answer. Pick one.'
  },
  {
    speaker: '',
    actions: ['sprite:gwen_haewon,embarrassed'],
    text: 'She says it to the ground. Her ears have gone red.'
  },
  {
    speaker: 'april_valentine',
    actions: ['sprite:april_valentine,embarrassed'],
    text: 'You\'re serious? You\'re actually serious.'
  },
  {
    speaker: 'gwen_haewon',
    actions: ['sprite:gwen_haewon,happy'],
    text: 'Six tomorrow morning. The track. If you meant it, you\'ll both be there.'
  },
  {
    speaker: '',
    actions: ['sprite:april_valentine,happy', 'sprite:gwen_haewon,embarrassed'],
    text: 'April squeals. Gwen walks off, slower than usual.'
  }
]

/** The rooftop with Lia, up to the point the player takes over. */
const kissNightLines = [
  {
    speaker: '',
    bg: 'rooftop',
    actions: ['show:lia_harper', 'sprite:lia_harper,neutral'],
    text: 'The rooftop door sticks, then gives. Lia is already at the railing with her sleeves pulled down over her hands.'
  },
  {
    speaker: 'lia_harper',
    actions: ['sprite:lia_harper,surprised'],
    text: 'Oh! Hi. I didn\'t think anybody else knew about this place.'
  },
  {
    speaker: '',
    actions: ['sprite:lia_harper,embarrassed'],
    text: 'She\'s holding a sketchbook shut against her chest.'
  },
  {
    speaker: 'lia_harper',
    actions: ['sprite:lia_harper,sad'],
    text: 'It\'s nothing, just the lights on Lowrise 3 in the fog. It\'s kind of stupid, you don\'t have to stay...'
  },
  {
    speaker: '',
    actions: ['sprite:lia_harper,embarrassed'],
    text: 'Lia\'s face is bright red as she glances down at your mouth, then back up to your eyes.'
  },
  {
    speaker: 'lia_harper',
    actions: ['sprite:lia_harper,happy'],
    text: 'Wow. It\'s getting... really warm up here... I think we should head back...'
  }
]

/** What the rooftop turns into once the player says it. */
const kissNightReplyLines = [
  {
    speaker: '',
    actions: ['sprite:lia_harper,embarrassed'],
    text: 'You step in and kiss her. The sketchbook drops between you.'
  },
  {
    speaker: 'lia_harper',
    actions: ['sprite:lia_harper,surprised'],
    text: 'You... did that on purpose? Sorry. Obviously you did. I\'ll stop talking.'
  },
  {
    speaker: '',
    actions: ['sprite:lia_harper,embarrassed'],
    text: 'She touches her lips and looks at the ground.'
  },
  {
    speaker: 'lia_harper',
    actions: ['sprite:lia_harper,happy'],
    text: 'Okay. Can we stay up here a bit longer?'
  }
]

/** PE on the track, both girls in their gym clothes from the first frame. */
const peDuoLines = [
  {
    speaker: '',
    bg: 'track',
    actions: [
      'show:morgana_notte',
      'sprite:morgana_notte,angry_pe',
      'show:marina_lewis',
      'sprite:marina_lewis,happy_pe'
    ],
    text: 'The coach is counting everyone off at the start line. Morgana is hugging her elbows in her gym shorts and glaring at the track.'
  },
  {
    speaker: 'morgana_notte',
    actions: ['sprite:morgana_notte,sad_pe'],
    text: 'One credit. I picked the class with the least running and they still make me do this. Outside. In daylight.'
  },
  {
    speaker: 'marina_lewis',
    actions: ['sprite:morgana_notte,surprised_pe'],
    text: 'It\'s two laps. I\'ll go at your pace, and we can talk about something horrible the whole way.'
  },
  {
    speaker: '',
    actions: ['sprite:morgana_notte,embarrassed_pe', 'sprite:marina_lewis,surprised_pe'],
    text: 'Morgana looks at her for a long moment.'
  },
  {
    speaker: 'morgana_notte',
    actions: ['sprite:morgana_notte,surprised_pe'],
    text: 'Something horrible? You mean that? You\'re not making fun of me?'
  },
  {
    speaker: 'marina_lewis',
    actions: ['sprite:marina_lewis,happy_pe'],
    text: 'I have a whole list. My sister worked a summer at a crematorium.'
  },
  {
    speaker: '',
    actions: ['sprite:morgana_notte,embarrassed_pe'],
    text: 'Morgana starts running. She glances back to check if you saw.'
  },
  {
    speaker: 'morgana_notte',
    actions: ['sprite:marina_lewis,surprised_pe'],
    text: 'If I die out here, no memorial. And no balloons.'
  },
  {
    speaker: 'marina_lewis',
    actions: ['sprite:marina_lewis,happy_pe', 'sprite:morgana_notte,surprised_pe'],
    text: 'Deal. We\'re doing a third lap, by the way. You stopped complaining, so.'
  },
  {
    speaker: 'morgana_notte',
    actions: ['sprite:morgana_notte,happy_pe'],
    text: 'I hate that you noticed. Stop smiling.'
  }
]

/** Selkie Beach with Livvie's whole household in tow. */
const beachLines = [
  {
    speaker: '',
    bg: 'beach',
    actions: [
      'show:livvie_tierra',
      'sprite:livvie_tierra,happy_swim',
      'show:ayla_nasser',
      'sprite:ayla_nasser,embarrassed_swim',
      'show:florentine_chastain',
      'sprite:florentine_chastain,angry_swim'
    ],
    text: 'Selkie Beach smells like salt and fried dough. Livvie has already laid out four towels in a row.'
  },
  {
    speaker: 'livvie_tierra',
    actions: ['sprite:florentine_chastain,embarrassed_swim'],
    text: 'Sit, sit! I brought the good sunscreen and I\'m doing everybody\'s shoulders. No arguing.'
  },
  {
    speaker: 'florentine_chastain',
    actions: ['sprite:ayla_nasser,surprised_swim'],
    text: 'I am perfectly capable of managing my own shoulders, thank you.'
  },
  {
    speaker: '',
    actions: ['sprite:florentine_chastain,surprised_swim', 'sprite:ayla_nasser,embarrassed_swim'],
    text: 'She holds her hand out for the bottle anyway.'
  },
  {
    speaker: 'ayla_nasser',
    actions: ['sprite:livvie_tierra,surprised_swim'],
    text: 'It\'s thirty-one degrees out here. I checked twice. ...I don\'t know why I told you that.'
  },
  {
    speaker: 'livvie_tierra',
    actions: ['sprite:livvie_tierra,happy_swim'],
    text: 'Because it\'s hot and you\'re being brave about it. Come sit in the shade, sweetheart.'
  },
  {
    speaker: '',
    actions: ['sprite:ayla_nasser,neutral_swim'],
    text: 'Ayla sits down, very upright, with her hands on her knees.'
  },
  {
    speaker: 'florentine_chastain',
    actions: ['sprite:florentine_chastain,happy_swim'],
    text: 'The water is... adequate. I tested it already. Somebody had to.'
  },
  {
    speaker: '',
    actions: ['sprite:ayla_nasser,surprised_swim'],
    text: 'Livvie hums to herself and drags Ayla\'s towel two feet closer to yours.'
  },
  {
    speaker: 'ayla_nasser',
    actions: ['sprite:ayla_nasser,embarrassed_swim', 'sprite:florentine_chastain,surprised_swim'],
    text: 'Oh. That\'s fine. That\'s a normal distance.'
  },
  {
    speaker: 'florentine_chastain',
    actions: ['sprite:florentine_chastain,angry_swim'],
    text: 'Mon dieu. Are we swimming or not?'
  },
  {
    speaker: '',
    actions: ['sprite:livvie_tierra,surprised_swim', 'sprite:ayla_nasser,surprised_swim'],
    text: 'She runs for the water. The three of you follow her in.'
  }
]

/** Closing hour in Kendall Library, the study slot that moves his Brains. */
const rankupLines = [
  {
    speaker: '',
    bg: 'library',
    actions: ['show:ayla_nasser', 'sprite:ayla_nasser,neutral'],
    text: 'Kendall Library is about to close. Ayla has your notes spread across the whole table.'
  },
  {
    speaker: 'ayla_nasser',
    actions: ['sprite:ayla_nasser,surprised'],
    text: 'You had it right the first time. You just crossed it out for no reason.'
  },
  {
    speaker: '',
    actions: ['sprite:ayla_nasser,embarrassed'],
    text: 'She taps the page twice, then looks around to see if anyone heard.'
  },
  {
    speaker: 'ayla_nasser',
    actions: ['sprite:ayla_nasser,happy'],
    text: 'Say it out loud once. Then you\'ll remember it.'
  }
]

/** CuteTea with Ingrid, landing on the two of them agreeing to go out. */
const milestoneLines = [
  {
    speaker: '',
    bg: 'cute_tea',
    actions: ['show:ingrid_gingham', 'sprite:ingrid_gingham,happy'],
    text: 'CuteTea is all pink lamps and tiny spoons. Ingrid has been explaining her campaign map for ten minutes and twisting the same strand of hair the whole time.'
  },
  {
    speaker: 'ingrid_gingham',
    actions: ['sprite:ingrid_gingham,surprised'],
    text: 'And the whole north is flooded, so the trade routes have to go... wait. Sorry. What did you just ask me?'
  },
  {
    speaker: '',
    actions: ['sprite:ingrid_gingham,embarrassed'],
    text: 'You ask her again, slower. Her hands drop from her hair to the table.'
  },
  {
    speaker: 'ingrid_gingham',
    actions: ['sprite:ingrid_gingham,happy'],
    text: 'Yes! Yes, obviously yes. I\'ve been waiting for you to ask since like week two.'
  },
  {
    speaker: '',
    text: 'She keeps saying yes, quieter each time, until the tea goes cold.'
  }
]

/** The six lines the two bedroom cuts share before they part company. */
const bedroomOpening = [
  {
    speaker: '',
    bg: 'haylee_valenzuela_room',
    actions: ['show:haylee_valenzuela', 'sprite:haylee_valenzuela,neutral'],
    text: 'Haylee\'s room is pitch black except for the projector throwing a French film on the wall.'
  },
  {
    speaker: 'haylee_valenzuela',
    actions: ['sprite:haylee_valenzuela,aroused'],
    text: 'Are you even watching? Maybe we need to take care of the distraction first...'
  },
]

/** Movie night, and nothing further. */
const sfwBedroomLines = [
  ...bedroomOpening,
  {
    speaker: 'haylee_valenzuela',
    actions: ['sprite:haylee_valenzuela,embarrassed'],
    text: 'Haylee gives you a gentle kiss, wrapping her arms around you.'
  },
  {
    speaker: '',
    actions: ['sprite:haylee_valenzuela,aroused'],
    text: 'She reaches up and takes her shirt off in one graceful motion, tossing it aside.'
  },
  {
    speaker: 'haylee_valenzuela',
    actions: ['sprite:haylee_valenzuela,happy'],
    text: 'Don\'t tell anybody about this. I have a reputation for being chill.'
  }
]

/** The same night with the player steering it somewhere else. */
const nsfwBedroomLines = [
  ...bedroomOpening,
  {
    speaker: '',
    actions: ['sprite:haylee_valenzuela,aroused_nude'],
    text: 'She reaches up and takes her shirt off in one graceful motion, tossing it aside.'
  },
  {
    speaker: '',
    actions: ['cg:nude_foreplay'],
    text: 'You slide your hands over her body, eliciting an impatient whimper from her throat.'
  },
  {
    speaker: 'haylee_valenzuela',
    text: 'Dios. Okay, don\'t, um. Don\'t stop doing that or I\'ll be so mad at you.'
  },
]

/** The platform at Veridan station with the storm already on top of it. */
const rainLines = [
  {
    speaker: '',
    bg: 'train_stop',
    actions: ['show:risa_colette', 'sprite:risa_colette,neutral'],
    text: 'Risa drops the stage voice, her voice barely audible above the whistling wind.'
  },
  {
    speaker: 'risa_colette',
    actions: ['sprite:risa_colette,sad'],
    text: 'It\'s just... I hate the rain. Which is a boring thing to hate. Everyone loves rain, it\'s cozy, whatever.'
  },
  {
    speaker: '',
    actions: ['sprite:risa_colette,surprised'],
    text: 'You hand her your umbrella and tell her to keep it. Her jaw drops comically.'
  }
]

/** Five questions in the register of the POL 101 lectures. */
const polQuestions = [
  {
    question: 'In Leviathan, how does Hobbes describe life in the state of nature?',
    a: 'Solitary, poor, nasty, brutish and short',
    b: 'A golden age of peaceful abundance',
    c: 'Governed from the beginning by the General Will',
    d: 'Ordered by the divine right of kings',
    correct: 'A'
  },
  {
    question: 'Rousseau defines the General Will as which of the following?',
    a: 'The sum of every citizen\'s private desires',
    b: 'The collective interest aimed at the common good of the sovereign whole',
    c: 'The published opinion of the largest faction',
    d: 'The judgement of the legislator who drafts the law',
    correct: 'B'
  },
  {
    question: 'For Hobbes, what do subjects give up when they enter the social contract?',
    a: 'All private property, held thereafter in common',
    b: 'The right to worship as they choose',
    c: 'The right to govern themselves, transferred to a sovereign',
    d: 'Nothing at all, since the contract only binds the sovereign',
    correct: 'C'
  },
  {
    question: 'Which line opens Rousseau\'s The Social Contract?',
    a: 'All political power grows out of the sword',
    b: 'Man is by nature a political animal',
    c: 'The state is the march of God in the world',
    d: 'Man is born free, and everywhere he is in chains',
    correct: 'D'
  },
  {
    question: 'Hobbes and Rousseau disagree most sharply on which question?',
    a: 'Whether the law must be written down to bind anyone',
    b: 'Whether people are naturally warlike or naturally peaceable',
    c: 'Whether a sovereign state requires fixed borders',
    d: 'Whether commerce between citizens should be taxed',
    correct: 'B'
  }
]

export const beats = {
  duoDay: {
    bg: 'quad',
    time: 0,
    cast: ['april_valentine', 'gwen_haewon'],
    lines: duoDayLines,
    action: 'Both of you.',
    reply: {
      lines: duoDayReplyLines,
      summary:
        'The reader told April and Gwen he wanted both of them, and neither of them turned him down.'
    }
  },
  kissNight: {
    bg: 'rooftop',
    time: 1,
    cast: ['lia_harper'],
    lines: kissNightLines,
    action: 'Just kiss her already!',
    reply: {
      lines: kissNightReplyLines,
      summary:
        'The reader kissed Lia on the Lowrise rooftop, and she asked him to stay up there with her a while longer.'
    }
  },
  peDuo: {
    bg: 'track',
    time: 0,
    cast: ['morgana_notte', 'marina_lewis'],
    lines: peDuoLines
  },
  textsBeach: {
    charKey: 'livvie_tierra',
    readerText: 'suuup wanna hang out?',
    replies: [
      'omg good timing! we were just looking for a fourth!',
      'ayla and florentine are about to go insane if we study any more',
      'wanna go to selkie beach with us?'
    ],
    summary:
      'Livvie gathered up Ayla and Florentine and invited the reader out to Selkie Beach for the afternoon.',
    hangout: {
      description:
        'The reader meets Livvie, Ayla and Florentine at Selkie Beach for an afternoon of swimming.'
    },
    scene: {
      bg: 'beach',
      time: 0,
      cast: ['livvie_tierra', 'ayla_nasser', 'florentine_chastain'],
      lines: beachLines
    }
  },
  rankup: {
    bg: 'library',
    time: 0,
    cast: ['ayla_nasser'],
    lines: rankupLines,
    stat: 'brain',
    before: { brain: 50, body: 40, heart: 45 },
    after: { brain: 62, body: 40, heart: 45 }
  },
  milestone: {
    bg: 'cute_tea',
    time: 0,
    cast: ['ingrid_gingham'],
    lines: milestoneLines,
    // Drawn in the dialogue box as "Ingrid loved that you ..." before the milestone sheet.
    memory: { type: 'loved', desc: 'you asked her to be your girlfriend over a tiny cup of tea' },
    event: 'isLover',
    emotion: 'happy'
  },
  exam: {
    code: 'POL 101',
    action: 'Head to the lecture hall for the POL 101 midterm.',
    questions: polQuestions
  },
  sfwBedroom: {
    bg: 'haylee_valenzuela_room',
    time: 1,
    cast: ['haylee_valenzuela'],
    lines: sfwBedroomLines
  },
  nsfwBedroom: {
    bg: 'haylee_valenzuela_room',
    time: 1,
    cast: ['haylee_valenzuela'],
    lines: nsfwBedroomLines,
    // What the player types after the shared opening; `turnAt` is the index it comes before.
    action: 'Forget the movie and kiss her.',
    turnAt: bedroomOpening.length
  },
  rain: {
    bg: 'train_stop',
    time: 0,
    weather: 'storm',
    cast: ['risa_colette'],
    lines: rainLines
  }
}
