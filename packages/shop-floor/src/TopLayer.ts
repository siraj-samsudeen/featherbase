import { useLayoutEffect, type RefObject } from 'react'

/** Where a floating panel sits against the control that opened it. */
export type TopLayerPlace = 'below-start' | 'below-end' | 'above-start' | 'right-end'

const GAP = 4

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
