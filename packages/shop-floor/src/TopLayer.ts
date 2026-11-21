import { useLayoutEffect, type RefObject } from 'react'

/** Where a floating panel sits against the control that opened it. `below-fit` is below, kept inside the window
 *  (placeCard): a peek card from a chip near the edge of a side panel (#1349, production bug of 20-Nov-2026). */
export type TopLayerPlace = 'below-start' | 'below-end' | 'above-start' | 'right-end' | 'below-fit'

const GAP = 4

/** The widest a fitted card goes, and the room it keeps from the window's edges and from its control. */
export const CARD_WIDTH = 340
const EDGE = 8
const CARD_GAP = 6

export interface CardPlace { left: number; top: number; width: number; side: 'below' | 'above' }

/**
 * Where a fitted card goes: under its control, aligned to its left edge, shifted left as far as it must to stay in
 * the window, and above the control when there is no room below but there is above. Never wider than the window.
 */
export function placeCard(control: { left: number; top: number; bottom: number }, card: { height: number },
  view: { width: number; height: number }): CardPlace {
  const width = Math.min(CARD_WIDTH, view.width - 2 * EDGE)
  const left = Math.max(EDGE, Math.min(control.left, view.width - width - EDGE))
  const below = control.bottom + CARD_GAP
  const above = control.top - CARD_GAP - card.height
  const flip = below + card.height > view.height - EDGE && above >= EDGE
  return { left, top: flip ? above : below, width, side: flip ? 'above' : 'below' }
}

/**
 * A menu or picker opened from the sidebar floats above everything on the page, an app's own panels and
 * iframes included (a Dive report covered View As's list, 20-Nov-2026). It is lifted into the browser's top
 * layer (the Popover API) and placed beside its anchor with fixed coordinates, kept there on scroll and resize.
 * The panel stays where React drew it (inside the bar's shadow root, with its styles). A browser without the
 * Popover API keeps the panel's own placement.
 */
export function useTopLayer(open: boolean, panel: RefObject<HTMLElement | null>, anchor: RefObject<HTMLElement | null> | (() => HTMLElement | null), place: TopLayerPlace) {
  useLayoutEffect(() => {
    const el = panel.current
    const at = typeof anchor === 'function' ? anchor() : anchor.current
    if (!open || !el || !at || typeof el.showPopover !== 'function') return
    el.setAttribute('popover', 'manual')
    el.showPopover()
    function position() {
      const r = at!.getBoundingClientRect()
      const s = el!.style
      s.position = 'fixed'
      s.margin = '0'
      s.inset = 'auto'
      if (place === 'below-fit') {
        const p = placeCard(r, { height: el!.getBoundingClientRect().height }, { width: window.innerWidth, height: window.innerHeight })
        s.left = `${p.left}px`
        s.top = `${p.top}px`
        s.width = `${p.width}px`
        el!.dataset.side = p.side
        return
      }
      if (place === 'below-start' || place === 'below-end') s.top = `${r.bottom + GAP}px`
      else s.bottom = `${window.innerHeight - (place === 'above-start' ? r.top - GAP : r.bottom)}px`
      if (place === 'below-end') s.right = `${window.innerWidth - r.right}px`
      else s.left = `${place === 'right-end' ? r.right + 2 * GAP : r.left}px`
    }
    position()
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      // A panel still on the page leaves the top layer; one React removed has left it already.
      if (el.isConnected) el.hidePopover()
    }
  }, [open, panel, anchor, place])
}
