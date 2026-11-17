// #1251: where a shortcut tip lands. Just below the top bar, as near the middle
// as it can, and never on a control: not a header button, not the control the
// person just used (the mockup's tip covered the header's buttons; the agreed
// design forbids it).

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

const GAP = 8
const STEP = 16
const ROWS = 4

function clear(candidate: Box, avoid: Box[]): boolean {
  return !avoid.some((a) => a.left - GAP < candidate.right && candidate.left < a.right + GAP && a.top - GAP < candidate.bottom && candidate.top < a.bottom + GAP)
}

/** The tip's top-left corner within `area` (left and right edges, the top it starts at). */
export function placeTip(size: { width: number; height: number }, avoid: Box[], area: { left: number; right: number; top: number }): { left: number; top: number } {
  const room = area.right - area.left - size.width
  if (room < 0) return { left: area.left, top: area.top }
  const centre = area.left + Math.round(room / 2)
  const lefts: number[] = [centre]
  for (let d = STEP; d <= room; d += STEP) {
    if (centre + d <= area.left + room) lefts.push(centre + d)
    if (centre - d >= area.left) lefts.push(centre - d)
  }
  lefts.push(area.left, area.left + room)
  for (let row = 0; row < ROWS; row++) {
    const top = area.top + row * (size.height + GAP)
    for (const left of lefts) {
      if (clear({ left, top, right: left + size.width, bottom: top + size.height }, avoid)) return { left, top }
    }
  }
  return { left: centre, top: area.top + ROWS * (size.height + GAP) }
}
