# Venus University

A local, single-player, AI-driven dating sim in visual-novel form: an Electron desktop app (React 19, TypeScript, Zustand, Motion, Vitest) in which a cloud LLM (Gemini) writes the scenes and a locally managed ComfyUI renders the character art. There is no server; everything the player configures lives in `data/settings.json`.

## Before you start

- Skim `DESIGN_GUIDE.md` first so you know what this repo is, where things live and which rules every change keeps. Then review the sections relevant to your task thoroughly before implementing, and take the codebase's existing practices and behaviors into account.
- If the change touches anything on screen — a view, a component, a `vu_styles` file, motion — read `UI_STYLE_GUIDE.md` as well and follow its conventions.
- The code is authoritative where a guide and the code disagree; fix the guide.

## While you work

- Follow `DESIGN_GUIDE.md`'s guidance on tests: the suite defends save integrity and the pure functions a save is computed from. Err on the side of fewer tests, never trivial ones — no tests for prompt wording, labels, formatting or shipped content — and verifying a feature by hand with no new test is a valid outcome.
- No code or comment may point at either guide. A comment says what the code below it does.
- Update `DESIGN_GUIDE.md` and `UI_STYLE_GUIDE.md` when a change alters something they state, and not otherwise. Never duplicate information between the two: appearance belongs to the style guide, everything else to the design guide.
- Suggest changes to `TESTING_PLAN.md` as you see fit, but never edit it yourself.
- If you spawn subagents, use a model and effort appropriate to the task. Try not to use Fable for subagents.
- When using Fable to implement a plan, hand off most of the work to non-Fable agents, then check their work instead of doing it yourself.
- If anything is unclear, ask clarifying questions before finalizing your plan.
- Don't assume that I know better than you. If you have suggestions for a better way to do things, raise them as questions.

## Finishing

- `npm run typecheck` and `npm test` must pass; anything neither can catch is verified in the running app.
- In the last step of your plan, commit all of your changes in a single commit to main
