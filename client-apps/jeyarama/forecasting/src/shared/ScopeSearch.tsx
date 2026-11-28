// Start anywhere (the managers' prototypes): one search box under the page header finds a store, floor, section,
// division, subdivision, category or subcategory; choosing one scopes the page until its chip is removed. `/`
// focuses the box; ↑ ↓ move, Enter opens, Esc clears then closes. The box is Shop Floor's SearchInput, the results
// a raised menu, the scope chips FilterChips with a KindTag. The logic is scope.ts; useScope keeps the choice.
import { useEffect, useMemo, useRef, useState } from 'react'
import { FilterChip, KindTag, MENU_HEADING_CLASSES, SearchInput, cx, menuItemClasses, raisedClasses } from '@featherbase/shop-floor'
import { GapToAop } from './Aop'
import { combine, count, inr, type Line } from './model'
import { buildIndex, choose, inScope, KINDS, nearest, results, starts, type Entry, type Kind, type Scope } from './scope'

/** The page's scope and the lines in it. A page reacts to a new scope (opens its tree) through `onChange`. */
export function useScope(all: Line[], onChange?: (scope: Scope[], lines: Line[]) => void) {
  const [scope, setScope] = useState<Scope[]>([])
  const lines = useMemo(() => (scope.length ? all.filter(inScope(scope)) : all), [all, scope])
  const set = (next: Scope[]) => { setScope(next); onChange?.(next, next.length ? all.filter(inScope(next)) : all) }
  return {
    scope, lines,
    choose: (e: Entry) => set(choose(scope, e)),
    remove: (i: number) => set(scope.filter((_, k) => k !== i)),
    clear: () => set([]),
  }
}
export type ScopeState = ReturnType<typeof useScope>

const KIND_WORD: Record<Kind, string> = { store: 'store', floor: 'floor', section: 'section', division: 'division', subdivision: 'subdivision', category: 'category', subcategory: 'subcategory' }

/** The search box and, under it, the scope chips with what the scope holds. */
export function ScopeSearch({ all, state, kinds }: {
  /** Every line the page may show (the box searches these). */
  all: Line[]; state: ScopeState
  /** The kinds this page can be searched for; by default those the lines have. */
  kinds?: Kind[]
}) {
  const index = useMemo(() => buildIndex(all, kinds), [all, kinds])
  const has = (k: Kind) => index.some(e => e.kind === k)
  const many = new Set(all.map(l => l.store)).size > 1
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(false)
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const slash = (e: KeyboardEvent) => {
      if (e.key !== '/' || (e.target as HTMLElement).closest?.('input,textarea,select,[contenteditable]')) return
      e.preventDefault(); input.current?.focus()
    }
    document.addEventListener('keydown', slash)
    return () => document.removeEventListener('keydown', slash)
  }, [])

  const found = q.trim() ? results(index, q, state.scope) : []
  const near = q.trim() && !found.length ? nearest(index, q) : []
  const startGroups: [string, Entry[]][] = q.trim() ? [] : ([[many ? 'store' : 'floor', many ? 'Start at a store' : 'Start at a floor'], ['division', 'Start at a division'], ['subdivision', 'Or a subdivision']] as [Kind, string][])
    .map(([k, t]): [string, Entry[]] => [t, starts(index, k, state.scope)]).filter(([, es]) => es.length > 0)
  const flat = q.trim() ? (found.length ? found.flatMap(([, es]) => es) : near) : startGroups.flatMap(([, es]) => es)
  const pick = (e: Entry | undefined) => { if (!e) return; state.choose(e); setQ(''); setShown(false); input.current?.blur() }
  const placeholder = `Search a ${(['store', 'floor', 'section', 'division', 'subdivision', 'category'] as Kind[]).filter(has).map(k => KIND_WORD[k]).join(', ')} or subcategory`

  const item = (e: Entry, i: number) => {
    const ls = state.scope.length ? e.lines.filter(inScope(state.scope)) : e.lines, o = combine(ls, -1), stores = new Set(ls.map(l => l.store)).size
    const meta = e.kind === 'store' ? e.sub : (e.kind === 'category' || e.kind === 'subcategory') && many ? `at ${stores} store${stores === 1 ? '' : 's'}` : ''
    return (
      <button key={`${e.kind}:${e.key}`} type="button" role="option" aria-selected={sel === i} data-testid="search-result"
        className={menuItemClasses({ className: cx('fr-fs-item', sel === i && 'bg-hover') })}
        onMouseDown={ev => ev.preventDefault()} onMouseEnter={() => setSel(i)} onClick={() => pick(e)}>
        <KindTag>{KINDS[e.kind].name}</KindTag>
        <span className="fr-fs-main"><span className="fr-fs-label">{e.label}{meta && <span className="fr-detail"> {meta}</span>}</span>
          {e.path.length > 0 && <span className="fr-fs-path">{e.path.join(' › ')}</span>}</span>
        <span className="fr-fs-num"><b>{inr(o.fc)}</b>{o.aop ? <GapToAop o={o} /> : <span className="fr-dim">no AOP</span>}</span>
      </button>)
  }
  let n = 0
  const inScopeLines = state.lines, sum = combine(inScopeLines, -1)
  return (
    <div className="fr-search" data-testid="scope-search">
      <div className="fr-fs-box">
        <SearchInput ref={input} value={q} placeholder={placeholder} aria-label="Search" role="combobox" aria-expanded={shown} autoComplete="off" spellCheck={false}
          onChange={e => { setQ(e.target.value); setSel(0); setShown(true) }} onFocus={() => setShown(true)} onBlur={() => setShown(false)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, Math.min(flat.length - 1, s + (e.key === 'ArrowDown' ? 1 : -1)))) }
            else if (e.key === 'Enter') { e.preventDefault(); pick(flat[sel]) }
            else if (e.key === 'Escape') { e.preventDefault(); if (q) setQ(''); else { setShown(false); input.current?.blur() } }
          }} />
        <kbd className="fr-kbd" aria-hidden>/</kbd>
        {shown && <div className={raisedClasses('fr-fs-pop')} role="listbox" data-testid="search-results">
          {q.trim()
            ? found.length
              ? found.map(([k, es]) => <div key={k}><div className={MENU_HEADING_CLASSES}>{KINDS[k].plural}</div>{es.map(e => item(e, n++))}</div>)
              : <><div className="fr-fs-empty"><b>Nothing called “{q.trim()}”{state.scope.length ? ' inside this scope' : ''}.</b> {near.length ? 'Nearest names:' : 'Try a store code, a division or a category.'}</div>{near.map(e => item(e, n++))}</>
            : <>
              <div className="fr-fs-starts">{startGroups.map(([t, es]) => (
                <div key={t}><div className={MENU_HEADING_CLASSES}>{t}</div>{es.map(e => { const i = n++; return (
                  <button key={e.key} type="button" role="option" aria-selected={sel === i} className={menuItemClasses({ className: cx('justify-between', sel === i && 'bg-hover') })}
                    onMouseDown={ev => ev.preventDefault()} onMouseEnter={() => setSel(i)} onClick={() => pick(e)}>
                    <span>{e.label}{e.kind === 'store' && <span className="fr-detail"> {e.sub}</span>}</span><b>{inr(combine(e.lines.filter(inScope(state.scope)), -1).fc)}</b></button>) })}</div>))}</div>
              <div className="fr-fs-foot">Type any name: {many ? <>a store code like <b>{all[0]?.store}</b>, </> : ''}a section, a division, a category or a subcategory. <kbd className="fr-kbd">↑</kbd><kbd className="fr-kbd">↓</kbd> move · <kbd className="fr-kbd">Enter</kbd> open · <kbd className="fr-kbd">Esc</kbd> close</div>
            </>}
        </div>}
      </div>
      {state.scope.length > 0 && <div className="fr-scope" data-testid="scope">
        <span className="fr-toolbar-label">Scope</span>
        {state.scope.map((s, i) => (
          <FilterChip key={`${s.kind}:${s.key}`} name={s.label} onRemove={() => state.remove(i)}>
            <span className="inline-flex items-center gap-1.5"><KindTag>{KINDS[s.kind].name}</KindTag>{s.path.length > 0 && <span className="fr-dim">{s.path.join(' › ')} ›</span>}<b>{s.label}</b></span>
          </FilterChip>))}
        <span className="fr-scope-sum">{count(inScopeLines.length)} subcategor{inScopeLines.length === 1 ? 'y' : 'ies'} · Feather Forecast <b>{inr(sum.fc)}</b> · {sum.aop ? <><GapToAop o={sum} /> to AOP</> : 'no AOP'}</span>
        {state.scope.length > 1 && <button type="button" className="fr-link" onClick={state.clear}>Clear all</button>}
      </div>}
    </div>
  )
}
