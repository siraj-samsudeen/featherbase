// #1251: where a shortcut tip lands: the highest spot in the page's content
// area that covers no control, as near the middle as it can. The candidate
// spots come from the real controls' edges (just below each, just beside
// each), so the answer follows the page as drawn, whatever its fonts or
// header (a fixed set of rows broke on CI's fonts, 17-Nov-2026).

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

const GAP = 8

function clear(candidate: Box, avoid: Box[]): boolean {
  return !avoid.some((a) => a.left - GAP < candidate.right && candidate.left < a.right + GAP && a.top - GAP < candidate.bottom && candidate.top < a.bottom + GAP)
}

/** The tip's top-left corner within `area`, or null when it fits nowhere. */
export function placeTip(
  size: { width: number; height: number },
  avoid: Box[],
  area: { left: number; right: number; top: number; bottom: number },
): { left: number; top: number } | null {
  const minLeft = area.left
  const maxLeft = area.right - size.width
  if (maxLeft < minLeft) return null
  const centre = minLeft + Math.round((maxLeft - minLeft) / 2)
  const lefts = [centre, minLeft, maxLeft, ...avoid.flatMap((a) => [a.right + GAP, a.left - GAP - size.width])]
    .filter((x) => x >= minLeft && x <= maxLeft)
    .sort((a, b) => Math.abs(a - centre) - Math.abs(b - centre))
  const tops = [area.top, ...avoid.map((a) => a.bottom + GAP)]
    .filter((y) => y >= area.top && y + size.height <= area.bottom)
    .sort((a, b) => a - b)
  for (const top of [...new Set(tops)]) {
    for (const left of lefts) {
      if (clear({ left, top, right: left + size.width, bottom: top + size.height }, avoid)) return { left, top }
    }
  }
  return null
}
