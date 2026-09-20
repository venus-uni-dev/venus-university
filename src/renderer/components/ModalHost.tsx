/** Portal target for every `Modal`, mounted once to keep stacking consistent. */
import type { JSX } from 'react'

export function ModalHost(): JSX.Element {
  return <div id="modal-root" />
}
