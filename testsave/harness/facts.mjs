// Lecture factoids the director hands the ledger as `classFactoid`, one per class meeting, each
// with the exam question it turns into. `lookupFact` matches a factoid the app sends back in an
// exam_quiz request to its entry.

const f = (fact, q, a, wrong) => ({ fact, q, a, wrong })

export const FACTS = {
  'ARH 101': [
    f('The Great Pyramid of Giza was built for the pharaoh Khufu.', 'For which pharaoh was the Great Pyramid of Giza built?', 'Khufu', ['Ramesses II', 'Tutankhamun', 'Akhenaten']),
    f('Egyptian reliefs show the head in profile and the torso from the front.', 'How do Egyptian reliefs usually show the human figure?', 'Head in profile, torso from the front', ['Entirely in profile', 'Entirely from the front', 'From behind, looking back over a shoulder']),
    f('A ziggurat was a stepped temple platform in ancient Mesopotamia.', 'What was a Mesopotamian ziggurat?', 'A stepped temple platform', ['A royal burial chamber', 'A fortified city gate', 'A covered marketplace']),
    f("Babylon's Ishtar Gate was built under Nebuchadnezzar II.", "Under which king was Babylon's Ishtar Gate built?", 'Nebuchadnezzar II', ['Hammurabi', 'Sargon of Akkad', 'Darius I']),
    f('The Parthenon in Athens was dedicated to the goddess Athena.', 'To which deity was the Parthenon dedicated?', 'Athena', ['Zeus', 'Apollo', 'Poseidon']),
    f('The three classical Greek orders are Doric, Ionic and Corinthian.', 'Which set lists the three classical Greek orders of architecture?', 'Doric, Ionic and Corinthian', ['Tuscan, Composite and Doric', 'Romanesque, Gothic and Ionic', 'Doric, Byzantine and Corinthian']),
    f('Contrapposto is a pose in which a figure rests its weight on one leg.', 'What is contrapposto?', 'A pose with the weight resting on one leg', ['A technique of softly blending tones', 'A painted illusion of architecture', 'A relief carved deep into stone']),
    f("The Pantheon in Rome is crowned by a concrete dome with an oculus at its top.", "What opening sits at the top of the Pantheon's dome?", 'An oculus', ['A lantern tower', 'A bell cote', 'A clerestory window']),
    f('The Arch of Titus commemorates the Roman capture of Jerusalem in 70 CE.', 'Which event does the Arch of Titus commemorate?', 'The capture of Jerusalem', ['The conquest of Gaul', 'The defeat of Carthage', 'The founding of Constantinople']),
    f('The Hagia Sophia was completed in 537 under the emperor Justinian.', 'Under which emperor was the Hagia Sophia completed?', 'Justinian', ['Constantine', 'Augustus', 'Charlemagne']),
    f('Byzantine mosaics set holy figures against gold backgrounds to suggest heaven.', 'What background do Byzantine mosaics use to suggest a heavenly space?', 'Gold', ['Deep blue', 'Black', 'Blood red']),
    f('Romanesque churches are known for thick walls, round arches and barrel vaults.', 'Which features mark Romanesque church architecture?', 'Thick walls and round arches', ['Pointed arches and flying buttresses', 'Onion domes and minarets', 'Glass walls and steel frames']),
    f('Gothic cathedrals used flying buttresses so their walls could hold large stained-glass windows.', "What let Gothic cathedral walls hold such large windows?", 'Flying buttresses', ['Barrel vaults', 'Post-and-lintel beams', 'Corbelled arches']),
    f('Giotto painted the fresco cycle in the Arena Chapel in Padua.', 'Who painted the frescoes of the Arena Chapel in Padua?', 'Giotto', ['Cimabue', 'Duccio', 'Fra Angelico']),
    f('Filippo Brunelleschi designed the dome of Florence Cathedral.', 'Who designed the dome of Florence Cathedral?', 'Filippo Brunelleschi', ['Leon Battista Alberti', 'Donatello', 'Lorenzo Ghiberti']),
    f("Masaccio's Holy Trinity is one of the first paintings to use linear perspective.", 'Which fresco by Masaccio is an early example of linear perspective?', 'The Holy Trinity', ['The Last Supper', 'The School of Athens', 'The Birth of Venus']),
    f('Sandro Botticelli painted The Birth of Venus.', 'Who painted The Birth of Venus?', 'Sandro Botticelli', ['Piero della Francesca', 'Giorgione', 'Andrea Mantegna']),
    f("Leonardo da Vinci's sfumato softens outlines through gradual blending of tones.", "What is Leonardo's technique of softening outlines with gradual tonal blending called?", 'Sfumato', ['Impasto', 'Tenebrism', 'Pointillism']),
    f('Michelangelo painted the Sistine Chapel ceiling between 1508 and 1512.', 'Who painted the Sistine Chapel ceiling between 1508 and 1512?', 'Michelangelo', ['Raphael', 'Leonardo da Vinci', 'Titian'])
  ],
  'LIT 330': [
    f('Greek tragedies were staged in competition at the City Dionysia festival in Athens.', 'At which Athenian festival were tragedies performed in competition?', 'The City Dionysia', ['The Panathenaia', 'The Olympic Games', 'The Eleusinian Mysteries']),
    f("Aristotle's Poetics says tragedy brings about catharsis through pity and fear.", 'According to Aristotle, tragedy achieves catharsis through which two emotions?', 'Pity and fear', ['Joy and sorrow', 'Anger and shame', 'Love and hate']),
    f("Hamartia is the error or flaw that brings about the tragic hero's downfall.", "What does Aristotle call the tragic hero's fatal error?", 'Hamartia', ['Hubris', 'Anagnorisis', 'Peripeteia']),
    f('Anagnorisis is the moment a tragic character recognizes the truth.', 'What is the tragic moment of recognition called?', 'Anagnorisis', ['Peripeteia', 'Stichomythia', 'Parodos']),
    f("Peripeteia is the sudden reversal of the hero's fortune.", 'What does peripeteia mean in tragedy?', 'A sudden reversal of fortune', ['A choral song', 'A comic interlude', "A messenger's speech"]),
    f('Hubris is the excessive pride that leads a hero to defy the gods.', 'What term names the excessive pride that leads a hero to defy the gods?', 'Hubris', ['Catharsis', 'Mimesis', 'Kommos']),
    f('Dramatic irony is when the audience knows something a character does not.', 'What is it called when the audience knows something a character does not?', 'Dramatic irony', ['Verbal irony', 'Deus ex machina', 'Hamartia']),
    f('Sophocles wrote Oedipus Rex.', 'Who wrote Oedipus Rex?', 'Sophocles', ['Aeschylus', 'Euripides', 'Aristophanes']),
    f("Aeschylus's Oresteia is the only complete Greek tragic trilogy to survive.", 'What is the only complete Greek tragic trilogy to survive?', 'The Oresteia', ['The Theban Plays', 'The Trojan Women', 'The Bacchae']),
    f('Euripides wrote Medea.', 'Which playwright wrote Medea?', 'Euripides', ['Sophocles', 'Aeschylus', 'Menander']),
    f("In Sophocles's Antigone, Antigone defies Creon to bury her brother Polynices.", 'Whom does Antigone defy Creon to bury?', 'Her brother Polynices', ['Her father Oedipus', 'Her sister Ismene', "Creon's son Haemon"]),
    f('The chorus in Greek tragedy comments on the action and speaks for the community.', 'What role does the chorus play in Greek tragedy?', 'It comments on the action for the community', ['It plays the villain', 'It performs only the comic interludes', 'It speaks only the prologue']),
    f('In Greek tragedy, violent deaths usually happen offstage and are reported by a messenger.', 'How is violence usually presented in Greek tragedy?', 'Offstage, reported by a messenger', ['Acted out in full view', 'Mimed by the chorus', 'Shown with puppets']),
    f('The deus ex machina was a god lowered onto the stage by a crane to resolve the plot.', 'What was the deus ex machina in Greek theater?', 'A god lowered by crane to resolve the plot', ['A masked chorus leader', 'A painted backdrop', 'An offstage sound effect']),
    f('Stichomythia is dialogue in rapid, alternating single lines.', 'What is stichomythia?', 'Rapid dialogue in alternating single lines', ['A long solo lament', 'A choral dance', 'A prologue spoken by a god']),
    f("Seneca's Roman tragedies strongly influenced Elizabethan revenge tragedy.", 'Which Roman playwright most influenced Elizabethan revenge tragedy?', 'Seneca', ['Plautus', 'Terence', 'Virgil']),
    f("Thomas Kyd's The Spanish Tragedy helped establish the English revenge tragedy.", 'Which play helped establish English revenge tragedy?', 'The Spanish Tragedy', ['Everyman', 'Volpone', 'The Alchemist']),
    f('Christopher Marlowe wrote Doctor Faustus.', 'Who wrote Doctor Faustus?', 'Christopher Marlowe', ['Ben Jonson', 'Thomas Kyd', 'John Webster']),
    f("Shakespeare's tragedies are written mostly in blank verse, unrhymed iambic pentameter.", 'What is blank verse?', 'Unrhymed iambic pentameter', ['Rhymed couplets', 'Free verse', 'Trochaic tetrameter'])
  ],
  'MSC 112': [
    f('Yeast ferments sugar into ethanol and carbon dioxide.', 'What does yeast produce when it ferments sugar?', 'Ethanol and carbon dioxide', ['Methanol and oxygen', 'Lactic acid and water', 'Acetic acid and nitrogen']),
    f('Saccharomyces cerevisiae is the yeast behind most ales, wines and breads.', 'Which yeast species is behind most ales, wines and breads?', 'Saccharomyces cerevisiae', ['Brettanomyces bruxellensis', 'Lactobacillus brevis', 'Aspergillus oryzae']),
    f('Lager yeast ferments at cooler temperatures than ale yeast.', 'How does lager yeast ferment compared with ale yeast?', 'At cooler temperatures', ['At warmer temperatures', 'Without any sugar', 'Only in open vats']),
    f('Malting sprouts barley so its enzymes can convert starch into fermentable sugar.', 'Why is barley malted before brewing?', 'So its enzymes can turn starch into sugar', ['To remove its gluten', 'To add bitterness', 'To kill wild yeast']),
    f('Hops give beer bitterness and aroma and help preserve it.', 'What do hops mainly contribute to beer?', 'Bitterness, aroma and preservation', ['Fermentable sugar', 'Carbonation', 'Alcohol content']),
    f('Malolactic fermentation converts sharp malic acid into softer lactic acid.', 'What does malolactic fermentation turn malic acid into?', 'Lactic acid', ['Citric acid', 'Acetic acid', 'Tartaric acid']),
    f('Red wine gets most of its tannins from grape skins, seeds and stems.', 'Where does red wine get most of its tannins?', 'Grape skins, seeds and stems', ['The yeast', 'Added sugar', 'The cork']),
    f('Acetobacter bacteria turn ethanol into acetic acid, which is how vinegar is made.', 'Which bacteria turn alcohol into vinegar?', 'Acetobacter', ['Lactobacillus', 'Saccharomyces', 'Streptococcus']),
    f('Kombucha is fermented by a SCOBY, a symbiotic culture of bacteria and yeast.', 'What does the SCOBY that ferments kombucha stand for?', 'Symbiotic culture of bacteria and yeast', ['Sugar-converting organic brewing yeast', 'Single-cell oxygenated bacteria', 'Sealed culture of barley yeast']),
    f('Sake brewers use koji mold, Aspergillus oryzae, to turn rice starch into sugar.', 'Which mold turns rice starch into sugar in sake brewing?', 'Koji (Aspergillus oryzae)', ['Penicillium roqueforti', 'Botrytis cinerea', 'Rhizopus stolonifer']),
    f("Ethanol boils at about 78 degrees Celsius, below water's 100.", 'At about what temperature does ethanol boil?', '78 °C', ['100 °C', '64 °C', '92 °C']),
    f('Distillers split a run into heads, hearts and tails and keep the hearts.', 'Which part of a distillation run is kept for drinking?', 'The hearts', ['The heads', 'The tails', 'The foreshots']),
    f('The foreshots are discarded because they concentrate toxic methanol.', 'Why do distillers throw away the foreshots?', 'They concentrate toxic methanol', ['They are too sweet', 'They are mostly water', 'They are too dark']),
    f('Ethanol vapor is highly flammable, so a still must be kept away from open flames.', 'Why must a still be kept away from open flames?', 'Ethanol vapor is highly flammable', ['Heat ruins the flavor', 'Flames add methanol', 'Copper melts easily']),
    f('A column still can distill continuously, while a pot still works in batches.', 'What sets a column still apart from a pot still?', 'It can distill continuously', ['It needs no heat', 'It can only make wine', 'It adds sugar during the run']),
    f("In the US, a spirit's proof is twice its alcohol by volume.", 'What is the alcohol by volume of an 80-proof spirit in the US?', '40%', ['80%', '20%', '60%']),
    f('A classic sour balances a spirit with citrus and a sweetener.', 'Which three elements make up a classic sour cocktail?', 'Spirit, citrus and sweetener', ['Spirit, cream and egg', 'Beer, soda and salt', 'Wine, bitters and water']),
    f('Cocktails with citrus juice are shaken, while all-spirit drinks are usually stirred.', 'Which cocktails are usually shaken rather than stirred?', 'Ones with citrus juice', ['Ones made only of spirits', 'Ones served neat', 'Ones topped with beer']),
    f('Aromatic bitters are used a few dashes at a time to season a cocktail.', 'How are aromatic bitters normally used in a cocktail?', 'A few dashes to season it', ['As the base spirit', 'As the main sweetener', 'Only as a garnish'])
  ]
}

/** Facts for a lecture code with no list of its own. */
export const GENERIC = [
  f('Water boils at 100 degrees Celsius at sea level.', 'At what temperature does water boil at sea level?', '100 °C', ['90 °C', '110 °C', '120 °C']),
  f("The mitochondria produce most of a cell's ATP.", "Which organelle produces most of a cell's ATP?", 'The mitochondria', ['The nucleus', 'The ribosome', 'The Golgi apparatus']),
  f('The Magna Carta was sealed in 1215.', 'In what year was the Magna Carta sealed?', '1215', ['1066', '1492', '1314']),
  f('Light travels at about 300,000 kilometers per second.', 'About how fast does light travel?', 'About 300,000 km per second', ['About 30,000 km per second', 'About 3,000 km per second', 'About 3 million km per second']),
  f('Photosynthesis turns carbon dioxide and water into glucose and oxygen.', 'What does photosynthesis produce?', 'Glucose and oxygen', ['Carbon dioxide and water', 'Nitrogen and methane', 'Starch and hydrogen']),
  f('The Pythagorean theorem says a squared plus b squared equals c squared.', 'What does the Pythagorean theorem state for a right triangle?', 'a² + b² = c²', ['a + b = c', 'a² − b² = c', '2a + 2b = c²']),
  f('Adam Smith wrote The Wealth of Nations in 1776.', 'Who wrote The Wealth of Nations?', 'Adam Smith', ['John Maynard Keynes', 'Karl Marx', 'David Ricardo']),
  f('DNA is built from four bases: adenine, thymine, guanine and cytosine.', "Which of these is one of DNA's four bases?", 'Guanine', ['Uracil', 'Glycine', 'Riboflavin']),
  f("Newton's third law says every action has an equal and opposite reaction.", "What does Newton's third law state?", 'Every action has an equal and opposite reaction', ['Force equals mass times acceleration', 'An object at rest stays at rest', 'Energy cannot be created or destroyed']),
  f("The Peace of Westphalia ended the Thirty Years' War in 1648.", "Which settlement ended the Thirty Years' War?", 'The Peace of Westphalia', ['The Treaty of Versailles', 'The Treaty of Utrecht', 'The Congress of Vienna']),
  f("Supply and demand set a market's equilibrium price.", "What sets a market's equilibrium price?", 'Supply and demand', ['Government decree alone', 'The cost of labor alone', 'The exchange rate']),
  f('The human heart has four chambers.', 'How many chambers does the human heart have?', 'Four', ['Two', 'Three', 'Six']),
  f('Plato founded the Academy in Athens.', 'Who founded the Academy in Athens?', 'Plato', ['Aristotle', 'Socrates', 'Pythagoras']),
  f('Sound travels faster in water than in air.', 'Where does sound travel faster?', 'In water', ['In air', 'In a vacuum', 'At the same speed everywhere']),
  f("Earth's atmosphere is about 78 percent nitrogen.", "Which gas makes up most of Earth's atmosphere?", 'Nitrogen', ['Oxygen', 'Carbon dioxide', 'Argon']),
  f('A haiku has three lines of five, seven and five syllables.', 'What is the syllable pattern of a haiku?', 'Five, seven, five', ['Seven, five, seven', 'Five, five, five', 'Three, five, three']),
  f('Johannes Gutenberg developed the movable-type printing press around 1440.', 'Who developed the movable-type printing press around 1440?', 'Johannes Gutenberg', ['William Caxton', 'Leonardo da Vinci', 'Martin Luther']),
  f('An acid has a pH below 7.', 'What pH does an acid have?', 'Below 7', ['Exactly 7', 'Above 7', 'Above 14'])
]

/** The fact list for a class code: its own, or the generic one. */
export function factsFor(code) {
  return FACTS[code] ?? GENERIC
}

/** A fact as the lookup compares it: whitespace collapsed, lowercased, no trailing period. */
function normalise(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[.]+$/, '')
}

const INDEX = new Map()
for (const [code, list] of [...Object.entries(FACTS), ['', GENERIC]]) {
  for (const entry of list) {
    const key = normalise(entry.fact)
    if (!INDEX.has(key)) INDEX.set(key, { ...entry, code })
  }
}

/** The entry a fact line was written from, with its class code ('' for generic), or null. */
export function lookupFact(text) {
  return INDEX.get(normalise(text)) ?? null
}
