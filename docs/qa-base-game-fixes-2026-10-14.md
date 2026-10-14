# Base-game QA fixes — 2026-10-14

These fixes reproduce on the unmodified base branch and require no community mods.

## Backup imports and ZIP exports

Both restore paths preflight collection shapes, IDs and row records before live writes; the browser explicitly aborts its transaction on a synchronous or asynchronous write failure.

The shared preflight uses the existing character, save, enrollment, playthrough and photo readers, including their supported schema upgrades. It rejects invalid collections and duplicate destinations before replacement. Browser restore remains a single IndexedDB transaction, including synchronous failures while queuing writes. Desktop restore does not gain a global filesystem transaction: an unrelated disk failure during a multi-file restore can still leave a partial restore.

Full backup and character exports create and validate a temporary sibling ZIP, then replace the destination using the existing retrying rename helper. Preparation, archive creation, validation and rename failures leave an existing export intact. Cleanup removes the temporary file only.

## Texting request ownership

Leaving a playthrough and starting another reply for the same character must not let the old send/retry completion clear the new request's busy flag or in-flight entry. Cleanup now checks the identity of the request it owns. This change is independent of text regeneration or any mod hooks.

## Validation

The same focused reproduction run on the unmodified base has six failures and four passing controls. Failures cover malformed desktop/browser imports, destruction of an existing ZIP when export preparation fails, a late synchronous browser write failure, and old send/retry completion releasing a newer reply. All pass with these fixes. Additional regressions cover partial archive creation, archive validation and rename failures, collection/record validation, and valid restore/export controls.

All three TypeScript checks pass. Full suite: 1634 passing tests, 1 existing skip, 115 files. Desktop and browser production builds also pass. Tests use synthetic saves, temporary files, fake IndexedDB and mocked text requests; no live API requests or user data.

This version is based on Venus Dev main at e67ec38 and preserves its newer semester fields and save/enrollment migration rules.
