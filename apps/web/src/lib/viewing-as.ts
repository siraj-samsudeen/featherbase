// #1222: while a tester views as someone, every page that means "me" is about that person (owner,
// 17-Nov-2026: "the tester sees every page as the user he is impersonating"). The browser keeps whom
// it views as here: set before the reload that starts View as, cleared at Exit, and corrected from
// the server's answer (ViewAs.tsx). Dash's own start button writes the same key.
export const VIEWING_AS_KEY = 'featherbase.viewing-as'

export interface ViewedPerson {
  row_id: string
  full_name: string | null
}

export function viewedPerson(): ViewedPerson | null {
  try {
    const raw = window.localStorage.getItem(VIEWING_AS_KEY)
    const value: unknown = raw ? JSON.parse(raw) : null
    return value && typeof value === 'object' && typeof (value as ViewedPerson).row_id === 'string' ? (value as ViewedPerson) : null
  } catch {
    return null
  }
}

export function setViewedPerson(person: ViewedPerson | null): void {
  try {
    if (person) window.localStorage.setItem(VIEWING_AS_KEY, JSON.stringify({ row_id: person.row_id, full_name: person.full_name }))
    else window.localStorage.removeItem(VIEWING_AS_KEY)
  } catch { /* private window: nothing kept, the server's answer still decides */ }
}
