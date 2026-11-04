# Venus University — UI style guide

## 0. How to read this

- This document is appearance only: shapes, colour, type, layout, interaction states and motion.
- Everything that is not appearance — routing, gates, stores, IPC, data shape — is `DESIGN_GUIDE.md`'s, and this guide points at it rather than restating it.
- The code is authoritative; where a rule and the code disagree, the code is right and the rule is stale.
- A screen that departs from a rule here is listed under "Deliberate exceptions" and nowhere else — if it is not listed, it is not an exception.
- Every rule is written for the next screen: read the section that names the thing you are drawing, then the exceptions.

## 1. The stage

- Screens are drawn in 1920×1080 units and scale to the window; main owns the zoom in one line and a screen measures nothing.
- Page zoom redefines the CSS pixel, so every box, rect and pointer coordinate in the renderer means what it says at every window size.
- The browser build has no page zoom and zooms the root element instead, so a rect is window pixels while `offset*`, `client*` and every pixel a screen writes stay stage units; a measurement that relates the two divides by the element's own rect-to-offset ratio.
- Never `vw`, `vh` or `vmin` in `vu_styles`: they measure the real window, which stops agreeing with the stage the moment the window is not 16:9.
- A screen-level layer anchors to the stage's edges with `inset`, positive or negative.
- Container units (`cqw`/`cqh`) are the sanctioned alternative where a box has to measure itself against another box.
- The bands fall out of two caps, so nothing is measured:

| Window | Zoom fits | Stage | Bars |
|---|---|---|---|
| 16:9, any size | height | 1920×1080 | none |
| wider than 16:9 | height | 1920×1080 | left and right |
| 4:3 to 16:9 | height | 1440–1920 × 1080 | none — the screen reflows |
| narrower than 4:3 | width | 1440×1080 | top and bottom |

- A stage-level layer is `absolute`, because `fixed` measures the window and in the wide band the window includes the letterbox; a veil is `absolute` too, so a dim stops at the stage's edge and the bars stay black.
- `#root` is sized in `stage.css` and nowhere else, and it carries the ground colour every screen is drawn on.
- A screen is checked at 1920×1080, 2560×1440, 1280×720 and 1440×1080; nothing may change but the size.
- The letterbox is painted black in `stage.css`, and nothing else may paint into it.

## 2. Files

- One `vu_styles/<Screen>.css` per screen, holding that screen's layout and nothing else.
- `index.css` imports the five shared files in order — `fonts`, `tokens`, `base`, `stage`, `window` — and `main.tsx` imports `index.css` first and `App` second, so a screen's file always loads after `base.css`.
- A rule earns its place in `base.css` on the second screen that needs it.
- Grep a promoted name across `vu_styles` before taking it: a screen file that already owns the name beats `base.css` on the properties it declares and silently inherits the rest.
- A file belongs to a component where two callers draw one object — `ComfyModels.css`, Settings' ComfyUI tab and the setup's own-ComfyUI card — and to a pair where two modals are one panel with two feet.
- A modal that is another modal's frame with its controls removed imports that modal's file rather than copying it.
- A file two screens import is named for the object it draws rather than for either screen.
- There is one design and one place for it: nothing that dresses a screen lives outside `vu_styles`.

## 3. Colour

- `tokens.css` declares named hues and then the roles on top of them; screens and primitives name roles only, and a rule naming a hue is a bug because it will not follow the theme.
- Night reassigns the roles on `[data-theme='night']`; day is written `:root, [data-theme='day']`, one selector list, so a day element inside a night one is genuinely day.
- The theme goes on a screen's own root element, never on `body`; a portalled modal inherits nothing and takes the value as a prop (§8).
- Three roles are shadows and each has one job: the layer behind a surface, the layer behind an accent fill, and the layer behind a modal panel.
- Four kinds of hue are never swapped: a state hue moves with a value, an identity hue never moves, a category says what claim an hour has on the reader, and a group says what a course is graded through.
- A group borrows the matching stat's hue and never its role: the stat roles reach a stat and nothing else.
- A pairing by *theme* earns a role; a pairing by element does not and stays in the screen's own file.
- Two roles are not colours: the curtain's polarity, which goes to the ends of the range instead of following the palette inward, and the wordmark's hue angle.
- Tint and border are one colour at night, so anything drawn in the border tone needs a ground that is not the tint, and anything that must survive a row hover is drawn a step louder.
- Three families of literal colour are exceptions and are listed in §20; nothing else in `vu_styles` writes a colour that is not a role.
- The category a class was generated from has no colour and no word on screen at all.

## 4. Type

- Three faces, three jobs: the display face for titles (one weight, never bold), the body face for everything spoken, the mono face for dates, money, codes, counts, states and metas.
- The body face carries the weight ladder — normal body, heavier labels, heaviest for a primary action — and italic is a whisper.
- All faces are bundled through `@fontsource` at one latin weight per file; never add a webfont link, the app must not fetch a font at runtime.
- The floor is 11px in mono and 12.5px in the sans; below that a reading stops being one.
- The merchant faces are the exception (§20): each reaches exactly one element on one shelf, and the goods stay in the app's three.
- Figures that change in place are tabular, or a box jitters as its digits change width under each other.
- `base.css` sets the body's ink and the body face once, and takes no font size: a screen states neither.

## 5. Icons

- Icons are inline SVG in the JSX, Lucide-shaped, stroke 2.5–2.75, round caps and joins.
- An icon is drawn in `currentColor`, so the control it sits in tints it.
- A mark drawn at several sizes takes its stroke width from the caller, since a width tuned at a label's size is a slab at a screen's.
- No icon font and no sprite sheet.
- A bitmap is recoloured by an SVG filter, never a CSS mask (§19).
- The half-of-day mark is the weather's where the slot is wet: the sun and the moon give way to the rain and the storm, which carry their idle inside the drawing and stand still in a grid.

## 6. The paper layer

- A shadow is a hard offset copy, never a blur, and one primitive draws all of them: `.vu-paper` is transparent, its `::after` is the face and its `::before` the shadow.
- Both pseudos inherit `border-radius`, so a shape is declared once on the element itself.
- `--paper-face`, `--paper-shadow` and `--paper-border` are the three knobs; an outline treatment puts its border on the face through the last so the element keeps no border of its own.
- `--paper-offset` and `--paper-tilt` are *declared* on the primitive and never left to a `var()` fallback: custom properties inherit, and motion reads the computed value as the base of a hover.
- The face is a pseudo-element and not a background.
- `overflow` never goes on a paper element: it clips the element's own shadow. Anything that crops does it in a child.
- When motion animates a parent of the paper, the base is declared on the animated element and the paper inherits it; a paper element in the same box that must not follow keeps the primitive's own declaration.
- Neither pseudo answers the pointer (§14).
- Quiet elements carry no paper layer at all — the shadow is what marks weight — and take a recessed fill instead.
- Tilt is one angle, −2°, everywhere paper appears; long rows relax to −1.2° and very wide panels to −0.8°, and variety comes from decoration and the fan rather than from scattered angles.
- A screen's corner archway is decoration: it takes no pointer, it is anchored past two or more stage edges with negative insets — an arch that frames a screen's text may run off the top as well as the side — and its corner and angle are the screen's to pick.
- A rotation and a swell are layout nobody reserved: every pixel one grows into is padded for by hand.

## 7. Shapes

- Shapes mean things: an archway is people, a half-pill flat right is a surface, flat left is an action, a full pill is neutral, and a rounded rectangle is a container.
- A reading takes the surface shape; an answer takes the action shape.
- `.vu-btn` — the action half-pill, text toward the flat edge, with `--primary` (accent fill), `--outline` (surface face behind an accent border), `--quiet` (recessed, no paper, hugging its words) and `--panel` (a modal's size rather than the menu's).
- `.vu-btn-sub` — the bookkeeping half of a button: italic mono, a status subline and never an explanation of why the button is dead.
- `.vu-chip` — the neutral full pill in mono, at a smaller paper offset.
- `.vu-tile` — a place the reader goes, mark over word, with `.vu-tile-badge` the count riding its square corner as a cutout ring; the fill stays the caller's.
- `.vu-square` — the small recessed square beside a field or a value; flat, and never an answer, since it adjusts or opens the thing next to it — the folder beside a ComfyUI model slot among them. `--step` is the one that steps that value by one.
- `.vu-arch` / `.vu-crop` / `.vu-crop-img` — a person and the child that clips her picture (§13); `.vu-card` is the tile around them, with `--card-zoom` saying how close the camera stands. `.vu-crop--masked` stands in for the picture wherever New Game masks her: the archway's own shape dashed, a question in it sized off the archway.
- `.vu-spoiler` — a masked name in the words or the heading it stands in: quiet and recessed, the struck eye before the name box's mask, and itself the control that lifts it.
- `.vu-circle` — back on a screen, the eye that opens a gallery, and the plus that opens the custom outfits; never a modal's close.
- A pill that opens a list wears the down chevron after its words and drops it while its pick is in force, when the same click clears the pick instead.
- `.vu-row` — one quiet entry in a list inside a panel; the list owns the gap and the row owns only its padding.
- `.vu-rows` — the column those rows stand in, its list marks reset, owning the gap.
- `.vu-empty` — the one line a list with nothing in it says, muted and italic; `--flush` where the panel already pads it.
- `.vu-sheet` — the wide half-pill list panel the roster modals share.
- `.vu-sheet--wide` — the wider chassis the edit modal, its wardrobe fixes and Create Photo share; Create Photo holds its left column at the height its background slot and twelve rows take, so the panel never resizes as a girl or the background is added or taken away.
- `.vu-bg-slot` — the background a picture, a created scene or a lorebook entry is set in, one object (`BgSlot.css`) with three callers, Create Photo, the Scene Creator and the Lorebook editor: the Add BG pill alone, or the picture small and quiet beside the Change BG pill and the ✕ its hover reveals.
- `.vu-sheet--saves` — the chassis the Load Game and Save Game panels share for two columns of cards.
- `.vu-pages-*` — a page of ten cards in two columns of five, numbered down the first column and then the second: a save card is the reading shape with its picture filling the round end at the card's full height, an empty slot is the dashed gap with its one word, the sticker rides every card's flat corner with the ✕ its sibling, the arrows either side stand the grid's full height, and the page's count under it reads `3 / 12` in the state voice. Save Game's pages stop dead at the first and run as far as the last page with a save on it when the panel opens, and turning past the last opens a blank one, which stands until the panel closes; Load Game's turn past either end onto the other, its autosave page counted as `AUTOSAVES` and its slot pages numbered as Save Game's are, and a lone autosave page stands no arrows. The wheel, the arrow keys and the arrows all turn the page. The arrows, the count and the wheel are one object (`PageArrows.css`) with three more callers: the CG picker, which turns as Load Game does, and the custom outfits panel, five wardrobes a page, and the custom CG panel, four pairs a page. None of them draws a count; their arrows stop dead at either end, stand nowhere while there is one page — their seats kept empty, so the page never moves — and give the last page's next seat to a plus once every slot on it is taken.
- `.vu-popups` — the frame inside a panel a combobox's floating list is placed against: the panel's whole box, taking no pointer of its own.
- `.vu-test-row` / `.vu-test-note` — a custom endpoint's Test connection, the writer's, the images endpoint's or the player's own ComfyUI's: the quiet button, the mono word it comes back with beside it, a `.vu-check-note` on its own line under it where a test costs the player something or needs something running, and on a failure the sentence on its own line below — for ComfyUI, one line per pack or model the server lacks.
- `.vu-rule` — the line between two groups on one surface: a flat bar of the tint, round-ended, under the main menu's big buttons.
- `.vu-note` — the prose panel a note modal is (Feedback, Support Development): action-shaped, `.vu-note-text` paragraphs — the same paragraph a dialog's message is — and whatever the note shows, then a `.vu-note-foot`.
- `.vu-track` / `.vu-bar` — a bar with a count behind it; both declare `display: block` so they work as inline elements.
- `.vu-ring` — the dotted circle `spin` turns, drawn in `currentColor`; it is a shape rather than a state, and the word beside it says what it means.
- `.vu-pic-action` — the pill a picture raises saying what a click on it does, revealed with the picture's own hover or focus.
- `.vu-x` — the ✕ that removes the thing it rides or stops what it is doing; it carries no position, and it is always a sibling of the face it rides rather than a child of it.
- `.vu-pill` — the flat outline pill for a utility beside the thing it acts on, never an answer a foot offers.
- `.vu-link` — an outward link inside prose: accent ink, underlined at rest, since it leaves the app and that is worth saying before the cursor is on it.
- `.vu-deadnote` / `.vu-deadnote-pill` — the wrapper around a control and the pill a hover raises over it (§14).
- `.vu-title` — a screen's name over its own tint blob, the blob leaning while the word does not. The New Game flow, New Game+ among it, stands its screens in order beside its title, those passed in the body's ink, the one on screen in the accent and those ahead muted.
- New Game's frame is one object (`NewGameFrame`) for every screen of the flow: the corner archway, the title row, the hint under it at reading size with the screen's own controls at that row's end — Occasions' New occasion pill among them, and on the title row where there is no hint — and a foot with Back at the far end from the primary, the screen's own utility pills beside Back — Occasions' Import, Export and Clear — and Skip generation beside the primary, kept clear of the room it doubles into.
- `.vu-tab` — a panel's title, on a modal or on a screen's own card, on a half-pill hung off the panel's corner, filled in the accent and taking the accent's shadow; it is the panel's forward layer, and whatever sits under that corner still owes it clearance.
- `.vu-slot` — a tile in a week grid, with `--on` for the pick, `--dead` for an hour already spoken for, a half mark and a note naming what holds it.
- `.vu-box-rewind` — the back mark on the box's round cap, mirroring the forward mark on its flat side.
- `.vu-scene-divider` — the rule and mono word standing in the well's place while a reply is being read, a strip at the row's feet inside the well's own box.
- `.vu-memrow` — a memory drawn as the sentence it is read as, her face and name, the verb as a select, "that", the words as a three-line field with the rest of the sentence standing level with its first line; one object for the boundary's question, the contact page's edit and New Game's memories panel, on the `.vu-memedit` panel all three wear; the last stands each row's day as a pill at its end, its ✕ raised by the row's hover.
- `.vu-sticker` — a label on the thing rather than a line about it: a quiet mono half-pill hung over the corner of what it names, un-accented and shallowly leaned; its side is the caller's. `.vu-sticker--accent` fills it in the accent with the accent's ink, the title tab's colours, for a label that is the game's rather than the player's — the autosave stickers on the save pages wear it, the numbered slots do not.
- `.vu-palette` / `.vu-palette-btn` — a tool palette, one control in N states rather than N switches: a row of rounded rectangles, icon over word, the one in force accent-filled, each `aria-pressed`; the wardrobe painter's tools and the artifact eraser's, a custom background's indoors or out, and the four skies over Create Photo's background picker. Settings stands one as a column of tabs in its panel's round end, each `role="tab"`, the panel held at one height whichever tab is on screen; New Game's Setting and Finalize screens each stand one the same way beside their panel (`.vu-palette--column`).
- Surfaces scale their radius to their own size and share no class; a screen's count beside its title is one of them.
- A row of cells that is one object rounds its two ends and leaves the middle square.
- No typographic arrow anywhere: where a forward mark helps it is an inline SVG chevron in `currentColor`.
- The fan rule goes on the list and not the buttons: a vertical stack of buttons deals like a hand, each row stepping clockwise about the flat edge they share, and `--fan-start`/`--fan-step` tune a longer or tighter one.
- A small cluster that is not a vertical list takes one shallow uniform lean instead, shallower than the paper tilt it sits on.
- `display: block` is stated on the primitives that may have to be built of `span`s, since an inline box clips nothing and has no height.
- A quiet control may clip, having no shadow to lose.

## 8. The modal shell

- `useModalShell(onClose)` gives every modal the same plumbing: the portal host, the press-and-release outside click, Escape and a right-click, and the leaving.
- `.vu-veil` sits at a literal `z-index: 100`, the modal tier, and the hangout lock above it at a literal `200`.
- The veil is `absolute` in `#root`, which is what makes centring on it centring on the stage in every band.
- A modal carries its own `data-theme`, handed down as a prop by the screen that opens it, because a portalled modal inherits neither the roles nor the theme-scoped state rules.
- Sub-modals are siblings of the veil in the same fragment, never its children, and their presence is `propagate` so they leave when the parent does. Every presence a modal holds is a sibling of every other, never a child of one: under `propagate` a child still rendered when the parent leaves is rendered twice under one key, and the parent never finishes leaving.
- A leaving modal is `inert` and answers no Escape, right-click, Enter or Space; only the top-most shell on the stack answers, and it keeps its place until it actually unmounts.
- Escape *is* the outside click, and so is a right-click anywhere but a field: a modal that ignores a click on the dimming ignores both, and that is the whole of how a one-way action is protected.
- A modal is left by a button and never a ✕: a glyph in a corner is the least legible way to offer the commonest answer.
- Every modal ends in the same foot: the quiet answers first, the primary rightmost, and anything the form has to say on its own line above the pair.
- `.vu-foot-stack` stands a `.vu-form-status` over a foot: a dot in the warn or good role and a few words about the form, right-aligned over the answers and keeping its height when it says nothing.
- An answer in a foot swells about its own centre rather than lunging at the one beside it.
- A panel with nothing to spend carries one answer; a panel where every value is already an answer commits on dismissal and carries no cancel.
- A panel that mixes the two — pickers that commit on change and typed fields that commit at the foot — keeps the foot for the typed fields and gates the way out on those alone.
- Typed fields that commit as each is left — Settings' Advanced tab and the Lorebook editor — are already answers: they gate nothing, and a value one cannot take is held in its box, named on the foot's status line and dropped on the way out.
- A panel that caps its height gives back what its own tab and paper overhang need, in stage units and never `vh`.
- `.vu-veil--bare` gives up the veil's padding for a modal that is a screen rather than a panel on one.
- A modal arrives as two layers, three where it wears a tab, on the openings §16 describes.
- A modal whose panel is a form answers Enter in either field with the foot's primary, and opens the focus on the first field.
- A modal whose primary the player reaches for by key — a status screen, a failure's Retry, a form's foot — hands it to the shell, and Enter and Space give it from anywhere but the panel's own fields and buttons: a field keeps both keys, and a focused button presses itself. The keys arm when the element carrying the primary lands, and a held key or one pressed before then is swallowed, so a key mashed through the lines before never answers a screen unseen.
- Two modals that follow one another share one presence in wait mode, standing beside the modal's other presence rather than inside it, so the second never arrives over the first still fading.
- A confirm whose answer closes the modal it belongs to takes itself down in the same event — its own flag off, then `onClose` — so it is not left as an exiting child rendered twice.

## 9. Fields

- `.vu-field` wraps a mono label and one input: a pill on a single line, a rounded box for multiline, a ground fill behind a border.
- Fields never rotate and never carry a paper layer — a well is not a sheet of paper.
- Nothing is drawn for focus: the caret is already blinking in the field being typed into, which is the mark.
- `.vu-check` keeps the real checkbox under the box drawn for it, so the label toggles it and the keyboard operates it.
- `.vu-check-meta` is the mono aside after a label — what a box costs, or which call it stands for.
- `.vu-check-note` is the prose a checkbox carries instead of a count: `.vu-check--noted` aligns the box to the label's first line rather than centring it on the paragraph, and the prose is said at rest and in full.
- A checkbox switched off deals its whole row `fieldDim`, as an input does, and says nothing.
- A slider is for an approximate value, and it carries the exact reading beside it rather than under it, where the hand would cover it; where the value has no unit anyone could read, a word at each end of the track stands in for the reading and no figure is shown at all.
- `.vu-range-row` is the labelled slider every screen builds from: the mono label, the track, and either the reading or the two end words.
- A select's caret is a pseudo on the box around it, the native one having been removed.
- A colour input is dressed as a field and keeps the native picker behind it, which is where the system eyedropper lives.
- A chip well is the one field the chip inputs share, and a select at chip size is its dropdown.
- A tag well's label carries a copy mark after its words while the well holds a tag, the bare mark in the label's muted ink; pressed, it turns to a check in the good role until its modal closes or another of that modal's marks is pressed.
- A multiline field grows with its own content and scrolls past its cap, so nothing is measured; the memory row's is the one held at three lines, a memory being one sentence, and scrolls past them.
- A field standing inside a sentence carries no label of its own and names itself with `aria-label`; a select there keeps its caret on the box around it.
- `.vu-field-hint` is the one line of body text under a label saying what shape the field wants, in the placeholder's muted italic.
- A field with suggestions is `ComboField`: the same `.vu-input`, wearing the select's caret only while it is empty and has something to offer. It empties when entered, takes its old value back when left empty, and hangs a floating rounded list under itself on the panel's `.vu-popups` frame — quiet, capped and scrolling, the one row in force tinted by state rather than motion. It stays free text whether or not the list arrived.
- That floating list is one object (`PopList.css`, `.vu-pop`) with two callers, the combo field and the Cast modal's custom-outfits pill, placed by one helper; a layer inside a modal that opens one takes Escape and a right-click ahead of the shell under it, through the shell's own stack, and closes on a press outside itself.

## 10. Lists and scrollers

- A row in a panel is quiet; the list owns the gap and the row owns its own padding.
- A vertical scroller is `overflow: hidden auto`, never `overflow-y` alone.
- A scroller pads for whatever lives outside a row's own box — the paper shadow, a hover's swell, a sticker's overhang — and the box that holds it takes that back with a matching negative margin, so the first row still lines up and the fade at its foot lands on the scroller's own edge.
- `.vu-scroll-box` is that holding box, one rule for every scroller that pads.
- A screen's header is its forward layer wherever a scroller reaches up toward it; a screen's own layers count from 1 and a panel's tab is 10.
- The scrollbar is `base.css`'s, one trio for the whole app; the fade at the foot of a scroller is `.vu-scroll-fade`, one rule for every scroller, standing right after the scroller it ends and drawn only while there is more to scroll to.
- A grid that scrolls clips in both axes, so it owes padding on every side something can grow into.
- A header row that holds one control for the thing beside it puts that control at the end of the row.
- The Lorebook tab stands its entries down the Chats tab's list column, the player's own over the shipped ones, with the one picked open beside it; a shipped entry the player changed wears an Edited sticker on its corner, and the file pills stand at the column's foot. The New entry and Edit setting pills share a row under the title, the second wearing the same sticker, raised clear of its label, while the setting is the player's; the setting opens in the system prompt editor's panel. New Game's Setting screen lays the same column and pane out in its own panel, a rounded rectangle, without the Edit setting pill: its Setting tab is the setting's box, filling the panel and scrolling inside itself. New Game's Occasions and Classes screens stand the same column and pane in that panel (`NewGameEntries`): Occasions lists the semester by date under month headings, the fixed occasions muted and one the player changed wearing an Edited sticker on its corner, and opens any of them on its fields, an invented one under a kind sticker, a select for its kind beside a When pill reading its days and half, and a quiet Delete occasion under them; a fixed one that may move carries a quiet Delete occasion, beside a Reset to default once it is changed, and one deleted wears a Deleted sticker in place of Edited and opens on its title and days over a quiet Restore occasion; Classes lists its sections, each with its count of whole entries and a warn dot where one is half-written, the majors standing under a ring while they are generated, and opens a section as its entries two across. Profiles lists the roster, each girl's face opening her row, what is decided of her year and major under her name, a warn dot on a half-set pair and her disposition once she knows the reader, and opens a girl as her sections down one scroll, each a mono heading over its fields as many abreast as the pane holds. On New Game+ a returning girl's row holds her carried year and major and opens as a note, and a Graduates section under the roster lists the girls who just graduated, each opening as her one field. Finalize stands that column of tabs — Occasions, Characters and Classes — beside the same column and pane, each tab listing what the semester was composed with: a changed row wears an Edited sticker, one holding a change that cannot be kept the warn dot, and its pane opens on its fields with the composed value behind each box, a warn note under a field that cannot be kept and a quiet Undo changes at its foot. Occasions lists by month; Characters by face, the graduates under their own heading on New Game+, a masked pick's pane holding only the mask over one line; Classes its sections and then its majors, each opening as cards two across, a major's name heading them where it may be renamed.
- The chat log's row is a stack beside a tool column at the row's end, kept on every row so the words line up: a pencil on a line that can be rewritten, swapped for a check over a cross while it is, and the words swapped for a box at their own size and inset.
- A list inside a panel sits a step down from the panel, so the rows on it read as rows.

## 11. Galleries

- A grid of pictures is a rounded rectangle of quiet cells: the weight in a gallery belongs to the images.
- Every image is captioned at rest — nothing in a gallery is hidden behind a hover (the app's hover-revealed labels are §14's).
- A gap in a set is drawn as a gap: a dashed cell carrying the screen's own word for that state, which fades out while a control on the cell is raised over it, the pill taking the recessed fill there.
- A control on a cell is revealed through motion variants driven by React state, so focusing the cell reveals it too.
- A control the player needs now is animated open and left there; hover-to-reveal is for a cell that is only sitting there.
- `.vu-gallery-*` is the grid, item, cell and caption every gallery is built from, and a picker of pictures is one.
- The Photos tab is a gallery of square cells: the dashed `+` first, then a cell per photo still being drawn — the ring over its state word — then the photos newest first, each captioned with the in-game date and half it was taken on. A photo opens in a rounded-rectangle viewer whose frame holds the picture at a fixed height budget, portrait or landscape, with the arrows standing either side of it.
- A gallery's count sits on the panel rather than on its accent tab, where neither state colour reads.
- `.vu-gallery-grid--wide` holds cells at the stage's own 16:9, the shape every background is drawn in; a cell the player can remove rides its ✕ on its top corner, a sibling of the cell in a `.vu-gallery-item--removable` (`.vu-gallery-x`).
- The background picker is one panel with four callers, the scene's Change BG, Create Photo's, the Scene Creator's and the Lorebook editor's, the last offering no rooms shelf: shelves in a rail beside a grid of those cells, the pick ringed, each place drawn under the sky it is being picked for — a wet one showing its rain render where it has one and the dry picture where it has none, as the stage would. The scene's is the slot's own sky; Create Photo's stands its sky palette over the shelves, and deals a place without the wet sky's render dead.
- The NSFW CG gallery stands each `_after` under its own act, four across. The custom CG panel is the same grid, each slot's main over its `_after` and the dashed `+` in an empty slot's top cell alone; a cell there that offers several controls — a main with a record adds Copy CG under its Regenerate — raises them as a stack of pills centred on the picture, siblings of it, with its ✕ on the corner, and the main's name is renamed from a pencil beside its caption, swapped for a box at the caption's size.
- The date picker is the Calendar's month frame without its day pane, the days it may pick live and the rest of each month dimmed; a press on a day is its answer. The Scene Creator's is the semester's own days with the occasions on them labelled; New Game's Occasions screen's is the days an occasion may move to, labelled with the occasions as the screen stands, a day the move may not take dimmed with its labels kept; New Game's Profiles' is the year before the semester, unlabelled. The slot picker is the same frame for the days and half an invented occasion takes, labelled with the other occasions as the screen stands: the Day, Night and All day palette stands at the head's end where the legend would, each day draws its two halves at its foot, lit in the accent where the run takes them, and since a run takes two presses its foot carries Cancel and Done.
- The CG picker is a gallery of the same cells a page at a time, the stock eight and then the custom pairs, each in the cell the custom CG panel stands it in, between the save pages' tall arrows, re-dealt at each turn as they are; a set not whole on disk is drawn as gaps, the pick is ringed, and pressing it again takes it off — the pick in force stays pressable even where its set is no longer whole, so a lock is never stranded.
- The player's own backgrounds are a gallery of those cells: the dashed `+` first, then each by its day picture under its name. The form that adds one stands its four pictures abreast as cells of the same grid, the plus in each empty one giving way to the upload pill.

## 12. The week

- Every calendar and week grid reads Sunday-first: Sunday opens the row and Saturday closes it.
- Once a playthrough has more than one semester, the Calendar's month reading carries the semester's name on a muted line under the month, so the reading keeps its width as the arrows cross from one semester's months into another's.
- That is a fact about how a week is printed and nothing else — slot indices stay Monday-zero underneath, so a screen reorders columns and never data.
- The order lives in `WEEK_COLUMNS` (`shared/jobs.ts`): labels are read out of the shared header array by index and the slot helper is handed the index.

## 13. People

- A character is an archway, and a card of one is two elements: the paper layer, and the crop inside it that clips the picture.
- `.vu-stage-portrait` is a sprite standing on the stage's ground at the stage's height, the game stage's and the milestone's alike.
- A state's border goes on the crop rather than through the paper's border knob: the crop fills the paper's padding box and paints over the face.
- A face in a list is quiet; a face that opens something is a control, and anything riding a face is its sibling rather than its child.
- A tile the player cannot take off a roster wears a sticker naming why on the corner the ✕ would ride, and no ✕: New Game+'s returning girls wear Returning, on their tiles and on their rows of the Profiles list, where the sticker hangs over the row's top edge as a lorebook row's Edited does.
- A sprite a click re-renders is a control on the picture inside the crop, never on the archway around it; so is the plus that fills an empty set, standing in a dashed crop where the gap's word would. A custom wardrobe's sprite offers Copy outfit under its Regenerate, the two raised as the custom CG cell's stack of pills, and a gap's word gives way to either.
- What rides the crop's square bottom corner — Hide, or Delete in the danger ink — is a sibling after the picture, and a title a click renames is the title itself, swapped for a box at its own size. A custom outfit's name keeps its own lowercase there and on the render strip, where every other set's title is in capitals, since the name is the word the writer is given, and a custom CG's name does the same on its caption, in the CG picker and on the strip; a column's inline links stand two to a row, the repairs first and Instructions in the second row's free seat.
- A character with an unknown name is drawn without a face outside the scene she is in, the mask being the point (`DESIGN_GUIDE.md` "Coding conventions"); inside it, the Cast modal and the gift picker keep her face and mask the name as the box does.
- New Game's setup masks a random pick: the masked crop in her archway and the box's mask for her name, the mask itself the control that reveals her wherever it does not stand inside another control — a row, a label, a confirm's words — where it is only the words. The height lineup stands her on its floor as her shape filled with a role, so her height still reads against the girls beside her.
- On the flow's Characters screen an empty tile holds a question, which gives way to the plus while the tile is under the pointer or focused.
- A map bubble the map stands up for want of known ones holds one archway: the add/drop's dashed `?` at a map face's size, with no caption.
- Gestures go by size: a card takes the card's lift, a small cluster's face takes none at all, and a portrait-sized control takes the portrait's gentler swell and the chip's press.
- A card that is waiting carries no paper layer and takes a flat recessed face.
- A caption is two fixed rows, given name over surname in a letterspaced mono strip, and it keeps its height whether or not the second row has anything in it.
- `profile.png` is cut at the archway's 5:6, so a portrait fills an arch without `object-fit` deciding anything, and every profile URL carries the sprite version.
- The voice lineup wears the height lineup's panel with a row apiece in place of its floor — her face and given name, the slider between its two end words, and the square that plays her voice — in two columns read down first; both lineups say what their answer reaches on a muted line over the foot.
- The reader's own picture is an archway like everyone else's, cut to the same 5:6 through a frame he drags over the whole picture, on the panel a character's portrait is framed on (`PortraitFramer`); without one the archway is the dashed gap holding a plus that opens the picker, and with one it opens that panel.
- In a scene the reader's picture stands over the box's round cap on a narrator's line, at about twice a speaker's size in the gap between the date and the words, clear of the widest date and of the words at every stage width. It fades with the box and breathes as a corner archway does, keeping its height against the box's top as the box grows.
- A control that is itself the way in says so with a mark rising over it, never a second button inside the first.
- A card is a control only where the view already said it opens something; otherwise its face is a plain element and takes no gesture.

## 14. Interaction states

- Only what has no duration is CSS's — selection and disabled — in one marked block at the foot of `base.css`; everything else is motion's.
- Nothing anywhere draws focus, and focus itself is untouched: fields still take it, a control clicked or focused in code still reports it to motion, and every focus-driven reveal stays live.
- `window.css` is the only unscoped file in `vu_styles`: no image tears off under the pointer, no text outside a field highlights, a missing picture draws nothing, no element is ringed, and the cursor is handed the one property the app publishes.
- The two halves CSS cannot say are said in `main.tsx`: Tab walks the fields of the form it is in on a captured keydown, steps nowhere from a lone field, and selects nothing otherwise, and the app installs no menu at all.
- The disabled rule is written against elements rather than classes, so a screen's own control owes the same dead state as a primitive without naming itself in `base.css`.
- No `::before`/`::after` is ever a hit target: inside a flex or grid control Chromium hit-tests the pseudo before the box, and the crossing from padding to label reads as a hover ending that never comes back.
- A dead control is 45% opacity with its paper shadow dropped outright, and **it says nothing**: the dim and the missing shadow are the whole of it.
- A control that deals itself in lands at the dim itself, since motion's inline opacity beats the rule.
- A disable notice is an exception approved one at a time, the test being that the reason is genuinely outside the screen: the registrar's enroll complaint, the wardrobe cover's setting note, the gallery eye's locked title, an unloadable save's line in Load Game, Load scene's line naming the deleted girl a saved scene can no longer be replayed without, the job board's stat-shortfall line above the shifts it grays, the Bunnyboard composer's one line while the graduation epilogue is on, the Game menu's Save Game while a reply, an ending's bookkeeping, a slot opening or a text is still out, the calendar's Replay at those same moments, while a call leaving would cancel is out and throughout a scene, a contact page's Edit milestones on Replay's terms but for those calls, the Settings foot's status line naming why Save is dead — a URL that cannot be sent to, a missing model id, or an id the endpoint's own list does not contain — Create Photo's foot status line while the model it would draw on takes no reference picture, or only one while a background is picked, the Upload custom BG foot's status line naming what keeps its name or its pictures from being saved, and the note below.
- The note is the app's hover-revealed label: a quiet mono pill raised over a control through React state. Over a dead control it names the missing prerequisite and nothing else — the scene's Gift once a gift has been given or while nobody is on the stage, the Edit Character modal's install-gated controls, Manage Characters' New Character tile where the build has no local renderer to offer, the Photos tab's `+` while no image key is set, the Game menu's Save Game while a reply, an ending's bookkeeping, a slot opening or a text is still out, the calendar's Replay on the same terms and throughout a scene, a contact page's Edit milestones on Replay's, and VenusBot's Change schedule once add/drop has closed and its Apply for a part-time job while he holds one. Over an icon-only control it names the action — the Edit Character modal's portrait, its pencil, the file squares under them and, for a shipped girl, Reset to default after them. The two hover-revealed cards, the scene's tips and the map's Go, are §20's, as is the scene's mid-reply action box. A hover label is added only where the owner has approved it by name, and every site is listed here.
- No `title` attribute anywhere; an icon-only control carries `aria-label`, the scene's back mark included.
- Text is selectable only where it is meant to be pasted: a field, the error detail well, and the exceptions in §20.
- Where there is nothing to offer, a control is absent rather than dead — except the ending modal's Download ending CG, which stays dead with no picture to give, since the panel's own copy has just mentioned the picture, My stuff's Use on cold medicine, which stays dead for the rest of a slot he has taken a dose in while his cold still shows, a custom panel's page arrow at either end of its pages, which stays dead so the pair never moves, and the Paste in the form that makes a custom wardrobe or pair, which stays dead until one of its kind has been copied.
- A screen's own key listener goes through `useWindowKeydown`, on the bubble phase so the modal in front answers first.

## 15. The cursor

- The app draws its own cursor as *the system's* cursor, through one `--vu-cursor` property `window.css` hands to `cursor`, composited by the OS; no file in `vu_styles` writes `cursor:`.
- What a cursor means is `data-cursor` on the element the click is aimed at, read off the element rather than off its CSS: dead first, then what it says, then what it is.
- The theme is read from under the pointer, then from the screen, and night otherwise.
- Nothing about it is animated, and it falls back to the system cursor wherever it is not drawing.

## 16. Motion

- `views/motion.ts` is the vocabulary and a screen only names it: no screen writes a duration, a spring or a keyframe.
- `main.tsx` wraps the app in `<MotionConfig reducedMotion="user">`, so a player who asks for less motion gets the fades and none of the movement without a screen opting in.
- An opening is one variant tree: the screen's root stays a plain element, each layer states its own delay, and a stack of controls staggers its children.
- Never put a transform or an opacity on a view's root — it becomes a stacking context and traps the modal host and the input lock below the layers they must cover.
- Every opening carries a `gone` label; a leaving is a tween where the arrival is a spring, since a spring's tail only holds an invisible thing in the DOM.
- `lift` and `press` reach the shadow through the paper's custom properties, which is what those properties are declared for.
- `rowLift` tints a control that already spans its column, `quietLift` swells one that hugs its words, `accentLift` lightens an accent fill rather than washing it out, `toggleLift` scales a control whose fill is a state, `cardLift` is a gentler lift for a card, and `cardSwell` adds the tint a card owes a reader who asked for less motion.
- `revealed` is the `peek`/`tuck` pair as one variants object, and `fieldDim` the dim a field deals itself, the disabled rule reaching buttons alone.
- A hover never animates a property a state class also sets: motion returns the property to the value it read at the first hover, not the one the class has set since.
- `gestures(dead, lift, press)` hands a dead control `idle` and never `undefined`, because a control that loses the prop under the pointer never hears the hover end and lifts by itself when it comes back to life.
- `hovered(dead, lift)` is the same pair without the press, for a control whose tap belongs to a child; either function marks a live control whose lift scales with `data-lift`, so what grows under the pointer is readable off the DOM.
- Hover state lifted into a parent is cleared when what it names leaves the screen, motion reporting no hover ending for an element that unmounts under the cursor.
- Every screen owes an idle: it answers nobody, takes no pointer, gates nothing, and is never the only way something is said.
- An idle composes on a wrapper where it writes a property a gesture or a state already owns, and on one variant where it does not — one element gets one animation per property.
- An idle's last keyframe is its rest frame: a transform target is applied instantly under reduced motion, at the last keyframe, so a breath ends where it began and a stepped loop ends on the frame it is drawn still at.
- A stepped idle is two frames held on a linear clock — the rain's drops jumping, the bolt tilting — and it rides the element inside its own drawing, never a wrapper that a gesture or another idle already turns.
- A phase offset is a negative delay, which starts a repeating clock part-way through its cycle rather than late.
- An idle built per element is minted once on mount and held, never rebuilt in render.
- A burst is the vocabulary's one one-shot (`components/Burst.tsx`): it fires on mount, ends at nothing, takes no pointer, and is thrown from the centre of the thing it rides — a word's splash in the word's own ink, a gift's glyphs or a happy turn's sparkles off a girl.
- Under reduced motion the transforms *and* the six positional keys — width, height, top, left, right, bottom — snap; opacities keep running, which is the reveal still being told.
- A layer driven by motion values rather than props owns its own reduced-motion branch, `MotionConfig` reaching neither.
- Springs are allowed for anything the player started or anything that should read as physical; a fade is a duration.
- A `Variants` object built during render is a new identity every render, so every variants object a screen hands motion is a module constant.
- A variant that omits a property does not leave it alone: it hands it back to `initial`, so two labels that are halves of one movement both name every property either touches.
- A key is what puts an animated element back where it starts, and a key must be unique among siblings or React keeps the stale node in front.
- Never `layout` on a paper element: a scaled box distorts the radius and both pseudos with it; a box that resizes tweens its own measurement instead.
- An `AnimatePresence` with `initial={false}` reaches every motion element in its subtree, so a keyed remount deep inside never reports a mount completion.
- An idle that scales a hard edge or a bitmap promotes its element with `will-change: transform`, or Chromium re-rasterizes it every frame.
- Motion writes `transform` and never the `rotate` property, so a CSS lean composes underneath a gesture and a gesture needs no wrapper element.
- A list that waits on a box adds no delay of its own: the box landing is the cue.
- A list that arrives with its box takes the quicker throw and the tighter step, there being no landing to wait on.
- A decorative layer answers a hover through React state, never through its own hover gesture.

### The crossing

- A scene change is covered rather than cut: two sheets crossing the stage under one shape.
- The layer animates through an imperative `animate()`, because each phase it reports is a store input that must fire exactly once.
- A wait is *declared* by the caller, never inferred.
- The curtain crosses the theme while it is opaque, so the reveal wipes in the colours of the screen it is revealing.
- A modal in front of a cover is waited out before the cover goes up.
- A cover raised on a question holds flat until it is answered: the quiet hold, the polarity turn and the splash all come after the answer, never under it.
- Under the cover the stage cuts: a background landing while the curtain is up draws with no fade, and a scene opening's curtain comes off only once the stage has drawn the first line's picture.
- A wait's caption may be renamed while the cover is down, and the mark does not restart when it is.

### The scene

- The box's dress is a string, and a change to it is a respawn.
- Anything that must be true on the frame a prop changes is decided in render, never in the effect that follows it.
- The entrance is a chain cued by landings; the way out is one state with its own delays.
- The typewriter is released by the box's wipe landing, and a click during the arrival lands the box rather than advancing.
- A rewind is a cut: every layer of the box and the stage lands at once, the typewriter included.
- The forward step over a line read before is the same cut.
- The wheel steps the scene a line a notch, however the notches arrive and whatever zoom the stage is drawn at — back over what was read, forward over what a rewind stepped back — and stops where the reading stopped; the left and right arrows step it a line a press the same way, except in a well that holds words.
- H clears the chrome as the HIDE chip does, and any key brings it back.
- Space turns the line as Enter does, and is a character in a field.
- Tab puts the caret in the well and brings it out over a reply as a click does; Tab in the well gives the caret up.
- A right-click closes the panel in front as Escape does, and on the bare stage opens the menu.
- The well takes the focus the moment the turn is the player's, and Enter on an empty well sends nothing.
- The well is put away the moment a reply starts to be read, whatever the pointer sits over, and comes back only on a mouse move across the divider's strip, never on a pointer merely resting there; it takes the focus only on a click or Tab.
- The strip lies inside the one-line well's own box and is the row's only hover zone while the well is away: the hidden well's box, Go's seat, End scene, the Gift and the tips mark all give the pointer up.
- The dialogue box drops onto the strip while the well is away and rises again with the well.
- A row going down mid-reply keeps the divider standing and the well away as it fades; the offer it loses on the way out swaps nothing in under the fade.
- The tips mark and the Gift stand only while the well is out, and fade with it; the Gift keeps its place in the row either way, so nothing beside it moves as the row changes over, and while it is out it holds the well out as Go does.
- End scene is the Gift's twin on the same terms, a quiet half-pill standing to the Gift's right; no rule stands between Go, the Gift and End scene.
- The row stands over a reply's last line as it does any other, and hands over to the turn's well only on the click past it.
- The well's draft is cleared when a line turns, forward or back; a press outside it leaves the words standing.
- A picture a cut mounts decodes synchronously, there being nothing left underneath it to hide a deferred decode.
- The layer answers no pointer and each control takes its own back, so there is no `stopPropagation` anywhere.
- The back mark on the box's round cap mirrors the forward mark on its flat side.

### The landing

- The landing and the slot's opening narration are one component, because the two wipes are one movement.
- The chromes cut rather than cross-fade.
- Everything the arrival hides takes the pointer with it, an opacity of zero still being a hit target.
- The phone tile's ring and shake wait for its deal to land, a duration rather than a completion, as the badge's first hop does.

### The pages

- A page turn re-deals its cards, wherever the page arrows stand; a custom panel opens on its first page as it stands.
- The arrows take the row's tint rather than a swell: a column the grid's full height, scaled, would spill over the count.

## 17. Display text

- A state or a reading is mono, uppercase and letterspaced, and a state word is never a sentence.
- One word per state across a screen: a gap in a set says the same thing wherever it appears.
- An empty state speaks in the app's voice, and the control that opens it stays live rather than going dead with nothing to say.
- A tally is a reading, and its colour says what it is short of; a count with nothing to be short of is not a state and takes the accent.
- A number on screen is a tier and never points (`DESIGN_GUIDE.md` "Coding conventions").
- A count that runs past three digits is shown compacted: at most three significant digits and a magnitude letter (K, M, B, T), trailing zeros dropped — `1K`, `12.3K`, `43M`, never `12345` or `12.45K`.
- Undiscovered is drawn rather than hidden, as a dashed slot naming what would open it.
- The reader is *he*: "the reader" in the fiction, "the player" at the keyboard.
- No arrow or caret glyph in a label.
- A button's words are the action it submits — trimmed where they must be, never rewritten.
- What the player needs is on screen at rest; the only hover reveals are §14's.
- `.vu-hint` — the one line saying what a click on the pictures beside it does; a control those pictures reveal on a hover is not offered without it.
- Two words for one thing on one screen is one too many.
- A placeholder in a field is a real value the control would submit, not a hint about one; the character sheet's prose fields are one exception, each empty one showing the shape its text wants in her name, and the New Game flow's fields the other, each empty one saying it will be generated, a select's blank option saying the same — but for a fixed occasion's, whose empty box shows the build's words, and Finalize's, whose empty box shows what was composed, each the value it keeps.
- A mark inside a line may change only the ink: a heavier weight or a larger size would move the words under the typewriter.
- Nothing in a line being typed leaves the flow at a point that moves: the caret is an empty inline standing in the line, and a mark's splash sits on a seat mounted with the run rather than with the burst, since a glyph or a box taken out of the line splits its shaping where it sits and re-wraps the words as they arrive.
- Where a colour is doing work, a legend says what it means at rest.

## 18. Day and night

- `views/clockTheme.ts` is the only source of the theme: a pure clock reading, the dev switch in front of it, and the hour a leaving game handed over in front of that.
- A screen calls `heldScreenTheme()` once on mount and puts the answer on its own root; nothing reads the clock twice.
- A game wears the *save's* half of the day rather than the clock's, so the sky and the chrome always agree.
- `forceTime` in `data/settings.json` is the dev switch for the app's own screens; it does not reach a game's screens, where patching a save stands in for it.
- The boot's own cover is the one thing the dev switch does not reach: the settings file has not been read when it goes up, so it opens in the machine clock's half whatever the switch says.
- A screen is looked at in both themes before it is done.
- A component that is not a screen but opens modals draws the theme once and hands it down without wearing it.

## 19. Assets

- The wordmark is a bitmap painted at one hue, so the theme turns it rather than recolouring it.
- A bitmap is recoloured through `feFlood`/`feComposite` in sRGB, with the filter's own colour interpolation stated; never a CSS mask, which is fetched under CORS and silently draws nothing in a packaged renderer loading from `file:`.
- A caller of a shared bitmap mark brings its own filter id, since two of them can be on screen at once.
- A missing picture draws nothing: an error is flagged in `main.tsx` and hidden in `window.css`, so the shape around it keeps its face.
- No screen carries an `onError`, and none should — a picture that may be missing is the normal case here.
- A large picture is decoded before the screen that needs it opens, one at a time, and held in a ref so it is not collected with what it decoded.
- A picture is shipped at the size it is drawn at: a grid of thumbnails never decodes the full renders behind it, and a drawing is no larger than the stage can show.
- Shipped backgrounds come from the bundler; character pictures and the player's own backgrounds from the app's own protocols.
- Only what will actually be shown is warmed: one half of the day, not both, and nothing behind a feature the player cannot yet reach — warmed while he is on the screen before the one that opens it.

## 20. Deliberate exceptions

- New Game's Classes screen names the pool each class is written for, the one place a class's category is a word on screen: the player is writing the pools themselves.
- The Reschedule grid is Monday-first, because what it prints is a forward run of dates rather than a week.
- The scroll fade keeps a `@keyframes` in `base.css`: it runs on its scroller's position rather than a clock, so it has no duration for the motion vocabulary to own, and a browser without scroll timelines draws it always.
- The game stage keeps `@keyframes` and one `transition`: each starts during render on a keyed mount and ends on `animationend`, and that completion is load-bearing state — except the background's fade, which starts once its mounted picture has loaded and does not run at all under the cover.
- The Bunnyboard's phone tilts clockwise, its shadow is larger than its face rather than offset from it, and its ears carry no paper layer — it is the app's mark at stage scale, and a mark wants all four sides.
- The day-change splash leans −7°, being a card thrown down rather than a panel.
- The landing's title leans with the fan it heads and draws its own blob, since motion cannot address a pseudo-element.
- The landing's suggestion wave is the one idle that stands down for the pointer, a moving row being a moving target.
- The scene's tips card is one of the app's two hover-revealed panels: raised off a mark beside the well through React state — a glyph over its word, outlined in the surface so it reads on any background — taking no pointer itself, since what it says is only wanted by a reader who has stopped to wonder.
- The map's Go card is the other: the place's one line, raised through React state at the panel's level because the frame clips, centred on the Go and always directly above it, poking out over the legend when the bubble is high, and taking no pointer either.
- The scene's mid-reply action box is a hover-revealed control rather than a label: the hover swaps the well in for the divider, the well being the control itself rather than a name for it, and it stands over the reply's last line until that line is turned.
- The crossing, the stat chart's walk and the money card's count animate motion values imperatively and each owns its reduced-motion branch.
- The course picker is the screen's own in-screen layer on the registrar, inheriting the theme, and is portalled from the add/drop modal.
- The reader's picture panel takes a width of its own and fits the picture inside a fixed box with container units, a picture being any shape where a character's portrait window is one.
- The hand preview, the prompt editor and a busy or one-way confirm ignore Escape, a right-click and the dimming alike, there being nothing a dismissal could answer.
- Hair labels, the repairs' chroma green and the merchants' colours are literals and do not follow the theme: each is a key or a brand rather than a job on a screen.
- A merchant's two extra faces reach one element each, and the goods stay in the app's own three.
- A shop's shelf overrides the app's scrollbar with the merchant's own, a shop being a website whose bar belongs to its page.
- The shop scales its mastheads' type through a `@container` query and the height lineup measures its floor in `cqh`; both are container units and neither is a viewport unit.
- The error detail well, the chat log's scroller and the phone's chat bubbles opt back into text selection, being made to be pasted or read at length.
- The chat log's rewrite box has no cap: it grows with its text and never scrolls on its own, the scroller around it doing the scrolling.
- The cursor is absent on the fatal error screen, which hands the system's own back.
- Opacity idles keep running under reduced motion — the registrar's two words, the typing dots, a tier crossfade and one shop's masthead rule — an opacity not being a transform.
- The registrar's half-of-day words are fitted SVG text, the stage's width not being a constant a font size could be tuned against.
- The crossing's return sheet takes a `clip-path`, a hole not being a `border-radius`.
- The milestone heart overrules a `fill` presentation attribute on the mark itself, an outline alone at that size reading as a wire.
- The milestone modal draws her as the stage's own sprite standing over the panel rather than as an archway: she is the screen's subject, and the crop, the height and the ground are the stage's, a shade closer. Her right fifth is clipped, past where any ordinary sprite reaches, so only an unusually wide one is stopped short of the lines.
- The Edit modal's portrait and the reader's own archway on his profile are the only archways in the app that are controls.
- The Cast modal's CG button is an action shape that takes the accent fill while her CG is over the stage: it is both the way into the picker and the sign that the lock stands.
- A character's room and the player's own backgrounds have no thumbnails, so the Change BG picker and the custom background gallery draw their full pictures, and only the shipped thumbnails are warmed.
- New Game's primary, every flow screen's Next and Finalize's Start game, stands at twice its size and tilted, the size riding a wrapper so the gesture composes.
- The Bunnyboard's chat rows and lorebook rows lift `.vu-row` to a surface fill, the list standing on the ground rather than in a panel.
- A sticker is the only rotated text outside the fan.
- The contact page and the self-improvement screen take the bare veil, both placing their own layers against the stage's edges.
- The contact page sizes the character in percentages, she being the subject rather than decoration, and clips her last tenth at the line where the cards' words begin, past where any ordinary sprite reaches.
- The crop frame and the repairs' brushes are dragged and bypass motion: a spring between the hand and the box it holds is lag.
- The map's layout, the scene's turn height and the brush ring write through `style.setProperty` on a ref, a per-element number CSS can read itself costing no render.
- A foot's answers pivot on their centre rather than the flat edge every other button pivots on.
- The map's two drawings do not turn with the theme: a night map is a night map, drawn once.
- The speaker pill is flat right where a name tab would be an action shape, since it answers nothing and its flat edge is the wipe's own front.
- `will-change: transform` lives in the screen's own sheet rather than in the motion vocabulary: it moves nothing and names no duration.
- The height lineup tints one paper shadow by data, a girl's own label colour, which is the only shadow in the app not set by a role.
- The phone's presence sets `presenceAffectsLayout` false: nothing under it animates layout, and the default remakes the presence context on every render of the screen, which redraws every row the feed holds.
- The main menu's footer notices are underlined accent words rather than button shapes: each is a remark about the build beside its version line rather than an entry in the menu, and neither is a `.vu-link`, since neither leaves the app.

## 21. What belongs in this guide

**Add:**

- A convention the moment a second screen follows it.
- An exception the day it lands, one line with why.
- The meaning of a new role, primitive or motion preset.

**Do not add:**

- Implementation detail the code already shows.
- Copy text, or anything quoted off a screen.
- A measurement tuned to one screen.
- History, post-mortems or rejected alternatives.
