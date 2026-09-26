# Venus University — Pre-release testing plan

Run this before every `butler push` after doing `npmsrun release`

- **Desktop**: copy `release/win-unpacked` to an outside folder and start "Venus University.exe"
- **Web**: copy release/web to an outside folder and do `npx serve` in the folder.

These tests are not intended to catch everything, it just runs over high traffic areas to get bang-for-testing-buck.

You will need externally kept data for testing:
- A save on the second week, not on Monday. With a class available to attend and a project available to work on.
- A save on the Tuesday of midterm week, with a midterm to attend
- A save during spring break
- A save on the week after spring break
- A save on the Tuesday of finals week, with a final to attend
- A save on the Sunday night before final scores are posted
- A save on the night before graduation

## Desktop


### Main Menu and Setup 
- [ ] On the Set up text generation screen, click into Custom and enter `https://openrouter.ai/api/v1`. Verify that models show up.
- [ ] Click back to Google AI Studio and enter an API key. Select Gemini 3.8 flash. Save.
- [ ] Open logging by doing `Get-Content data/app.log -Wait -Tail 10` on the root
- [ ] Install missing and verify that everything installs properly. Continue to main menu past NSFW modal.
- [ ] Press F11 and make sure the window resizes, stopping at a minimum size and creating black bars when going past supported aspect ratio.
- [ ] Verify that version matches.
- [ ] Open credits and check that all supporters/testers are there.
- [ ] Open Settings and click everything. Drag the music slider down to see that it still works.

### Manage Characters
- [ ] Open manage characters and import a character. Click it and open Edit Character. Click through all expressions on each outfit. Open NSFW CG and room BG.
- [ ] Regenerate an expression, then an outfit, then the Room BG, then an NSFW CG. Change a tag for each one and verify that on the next regenerate, the tag is still there.
- [ ] Change the pose and generate a Custom outfit: jumpsuit.
- [ ] Test Fix Holes.
- [ ] Test Fix Fingers.
- [ ] Change every field on the right side and verify that Save changes works.
- [ ] Export the character and reimport it. Delete the duplicate.
- [ ] Generate a blank character. Scroll through the boxes and check that nothing is prefilled. Clean it up with unfinished characters.
- [ ] Generate a character, checking every box

### Game
- [ ] Create a quick start save and play to the first decision point. Return to main menu and continue.
- [ ] Create a New Game. Fill empty slots randomly. Delete a character. Add a non-default character. Start the game.
- [ ] Shuffle a few times on the heights screen. Change the height of a character and sort. Save.
- [ ] Change the name to `Taeyung Min` and put `an international super-celebrity famous for his hit single "Lovin it".` Set Charm to Godly and Body to Decent.
- [ ] Do the first decision. Play to the end of the reply. Scroll back and find a place to edit to completely contradict the LLM output, then input your own action.
- [ ] Press H to hide/show the UI.
- [ ] Hide the character. Change her outfit. Change the background.
- [ ] Open the pause menu with Right click and Esc. Check that Controls are still accurate.
- [ ] Click Report a bug. Check that Download log works.
- [ ] Save the game on the second line, play to the end, then load the manual save. Load the autosave.
- [ ] Interrupt an ending screen. Click the "Don't warn". Check that it's on the set-up screen. Keep playing, then interrupt the ending again later.
- [ ] Play to the end. Edit the memory. 
- [ ] Open Bunnyboard. Check Chats. Check Friends and request the girl met as a friend. Check updates and like some posts. Check profile and verify that girls met and tokens generated updated. Verify that Bio is there. Upload a profile picture.
- [ ] Open Calendar and click through to the end. Check some occasions.
- [ ] Play another scene. Edit the output so you end up sleeping with a girl. Check that she sends a friend request after. 
- [ ] Play until the requested girl's friend request comes back, and check her edited memory.
- [ ] Go to class. Load a game from inside that scene. Load back and attend the class. Create a scheduled date with a girl via editing.
- [ ] Apply for a part time job.
- [ ] Attend the scheduled date.
- [ ] Go to the job shift.
- [ ] Do a solo scene.

### Second Week
- [ ] Attend class and verify that a fact is learned. 
- [ ] Work on a project.
- [ ] Start a hangout through a text.

### Midterms
- [ ] Open Bunnymap and click into Lowrise. Verify that it's either the kitchen or the lounge.
- [ ] Open Bunnyshop and trigger a gameover by buying too many things.
- [ ] Ditch midterms, buy something in the Bunnyshop, and gift someone something.
- [ ] Attend midterms. Check the log for the correct answers. Do a correct answer and an incorrect answer.

### Spring Break
- [ ] Open Bunnymap and check that certain girls are unavailable.
- [ ] Open the Calendar and check for rainy days and play one.

### After Spring Break
- [ ] Open Bunnymap and check that everyone is back.
- [ ] Go to classes and verify that scores are handed back.

### Finals
- [ ] Attend finals.

### Graduation and Goodbyes
- [ ] Attend graduation, click through a goodbye, then go home.
- [ ] Back up game data. Re-extract the version, enter an API key and skip generation. Restore the data and verify that everything is there.

## Web
- [ ] Enter an API key and don't check "Remember my key". Reload the window and check that it wasn't saved. Enter it again and remember it. Reload again and check that it was remembered.
- [ ] Check the version on the main menu screen. 
- [ ] Open settings and verify that "Check for updates" is missing and "Remember my key" is present. Check for the note about browser storage.
- [ ] Click on Feedback and download the log.
- [ ] Start a new game and play to the first decision point.
- [ ] Import an exported character.
- [ ] Import the desktop save.