// #1227 (Siraj, 16-Nov): every record shown is a link that opens it, or plain text only where the viewer may not
// open it. Stores (Site) and people (Employee) are the instance's own Tables, read through the org chart; whether the
// signed-in person may open them is asked of Featherbase, once per Table: its description answers only someone who
// may read it (Dash asks the same way). Unknown, or a failed answer, counts as no.
import { useEffect, useState } from 'react'
import { RecordLink } from '@featherbase/shop-floor'

const opens = new Map<string, Promise<boolean>>()
export function canOpenTable(table: string): Promise<boolean> {
  let answer = opens.get(table)
  if (!answer) {
    answer = fetch(`/api/table/${encodeURIComponent(table)}:meta`, { credentials: 'same-origin' }).then(r => r.ok, () => false)
    opens.set(table, answer)
  }
  return answer
}
function useCanOpen(table: string): boolean {
  const [can, setCan] = useState(false)
  useEffect(() => { let live = true; void canOpenTable(table).then(ok => { if (live) setCan(ok) }); return () => { live = false } }, [table])
  return can
}

/** A store, by its short code (its Site row), with the words to show. */
export function StoreLink({ code, name }: { code?: string | null; name: string }) {
  const can = useCanOpen('Site')
  return code ? <RecordLink table="Site" rowId={code} name={name} canOpen={can} /> : <>{name}</>
}
/** A person on the org chart, by their Employee row. */
export function PersonLink({ id, name }: { id?: string | null; name: string }) {
  const can = useCanOpen('Employee')
  return id ? <RecordLink table="Employee" rowId={id} name={name} canOpen={can} /> : <>{name}</>
}

/** In-app navigation, as the app's own links do: the address changes and the page follows. */
const go = (href: string) => { history.pushState(null, '', href); window.dispatchEvent(new PopStateEvent('popstate')) }
/** A page title naming where it is, "ATK · Girls Bottoms · December 2026" (the design session, 28-Nov: the title is
 *  navigation, like a breadcrumb): the store opens the store's sections, the section opens its review; the rest is
 *  words. An administrator's view keeps naming the place in the address. */
export function PlaceTitle({ store, section, rest }: { store: string; section?: string | null; rest: string }) {
  const at = (q: Record<string, string>) => `?${new URLSearchParams(q)}`
  return (
    <>
      <RecordLink table="Site" rowId={store} name={store} href={at({ view: 'sections', store })} onNavigate={go} />
      {section && <>{' · '}<RecordLink table="Section" rowId={`${store}-${section}`} name={section} href={at({ view: 'section', store, section })} onNavigate={go} /></>}
      {' · '}{rest}
    </>
  )
}
