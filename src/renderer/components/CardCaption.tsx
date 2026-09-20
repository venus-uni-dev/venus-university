import type { JSX } from 'react'
import type { Character } from '@shared/types'

export interface CardCaptionProps {
  character: Character
}

/** Her given name over her surname, the card's own anatomy. */
export function CardCaption({ character }: CardCaptionProps): JSX.Element {
  const given = character.firstName || character.lastName || 'Unnamed'
  const family = character.firstName ? character.lastName : ''

  return (
    <div className="vu-card-caption">
      <span className="vu-card-name">{given}</span>
      {family && <span className="vu-card-surname">{family}</span>}
    </div>
  )
}
