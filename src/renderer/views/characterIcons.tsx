import type { JSX } from 'react'

/**
 * The marks a character's action row wears, in the Edit modal and in the read-only panel
 * alike. Lucide-shaped and drawn in `currentColor`, so the square they sit in tints
 * them with one rule.
 */

export function DuplicateIcon(): JSX.Element {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="8" y="8" width="13" height="13" rx="3" />
      <path d="M4 16V6a2 2 0 0 1 2-2h10" />
    </svg>
  )
}

export function FolderIcon(): JSX.Element {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 20V6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
    </svg>
  )
}
