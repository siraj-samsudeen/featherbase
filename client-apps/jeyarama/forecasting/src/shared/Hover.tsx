import type { ReactNode } from 'react'
import { PeekCard } from '@featherbase/shop-floor'

/** A hover definition on a heading or a toggle: Shop Floor's PeekCard, opened by the pointer or by focus. */
export function Hover({ text, children }: { text: string; children: ReactNode }) {
  return <PeekCard label={text} trigger={<span tabIndex={0} className="inline-flex items-center gap-2">{children}</span>}><span className="text-sm">{text}</span></PeekCard>
}
