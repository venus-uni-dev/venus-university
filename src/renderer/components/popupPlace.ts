/**
 * Places a floating list in the panel's own units: the offsets up to the panel, less every
 * scroll on the way, so neither the modal's arrival transform nor a root zoom is read into the
 * figure. It flips above the box where there is no room under it, and takes the box's own width
 * where the list belongs to that box rather than hanging off a pill.
 */
export function placeUnder(
  box: HTMLElement,
  layer: HTMLElement,
  panel: HTMLElement,
  gap: number,
  matchWidth: boolean
): void {
  let top = box.offsetTop
  let left = box.offsetLeft
  for (
    let node = box.offsetParent instanceof HTMLElement ? box.offsetParent : null;
    node !== null && node !== panel;
    node = node.offsetParent instanceof HTMLElement ? node.offsetParent : null
  ) {
    top += node.offsetTop
    left += node.offsetLeft
  }
  for (let node = box.parentElement; node !== null && node !== panel; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight) {
      top -= node.scrollTop
      left -= node.scrollLeft
    }
  }

  // The width is written first: the list's height is what that width wraps its rows to.
  layer.style.setProperty('left', `${Math.round(left)}px`)
  if (matchWidth) layer.style.setProperty('width', `${Math.round(box.offsetWidth)}px`)
  const under = top + box.offsetHeight + gap
  const height = layer.offsetHeight
  const flip = under + height > panel.clientHeight && top - gap > panel.clientHeight - under
  layer.style.setProperty('top', `${Math.round(flip ? top - gap - height : under)}px`)
}
