/**
 * The university's own letters as a mark: the bitmap, and a filter that fills its alpha with
 * whatever colour the caller has. An SVG filter rather than a CSS mask: a mask image is fetched
 * under CORS, and a packaged renderer loading from `file:` would draw nothing.
 */
import type { JSX } from 'react'

import '../vu_styles/LettersMark.css'

export { default as lettersUrl } from '../../../assets/vu_letters_vector.png'

export interface LettersFilterProps {
  /** What the caller's own `filter: url(#…)` names. **Two callers may be mounted at once**, so
   * a screen brings its own id rather than sharing one. */
  id: string
  /** The class the caller declares its `flood-color` on — the whole of what picks the colour. */
  inkClassName: string
}

/**
 * The recolour itself, drawn nowhere: the flood takes the bitmap's own alpha, which is how the
 * Main Menu fills a sprite with a colour role.
 * `sRGB` is named because SVG's own default is linearRGB and would flood a colour no token says.
 */
export function LettersFilter({ id, inkClassName }: LettersFilterProps): JSX.Element {
  return (
    <svg className="vu-defs" aria-hidden="true" focusable="false">
      <filter id={id} colorInterpolationFilters="sRGB">
        <feFlood className={inkClassName} />
        <feComposite in2="SourceAlpha" operator="in" />
      </filter>
    </svg>
  )
}
