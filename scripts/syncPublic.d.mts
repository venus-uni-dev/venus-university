/** Types for `syncPublic.mjs`, so the test beside it type-checks. */

/** Whether one tracked path, relative to the repo root, belongs in the public mirror. */
export declare function isPublic(path: string): boolean

/** The character id for a path inside `assets/characters/<id>/`, whose folder ships zipped, else null. */
export declare function characterArchive(path: string): string | null
