import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminPageTitle } from 'shared'
import { api } from '../lib/api'
import { GLOSSARY_QUERY_KEY, GLOSSARY_TABLE, groupTerms, termAnchor, termMatches, useGlossary, type GlossaryTerm } from '../lib/glossary'
import { Button, Card, EmptyState, Notice, SearchInput, Skeleton, StatusPill, buttonClasses, labelClasses } from '../components/ui'
import { BookOpen, Pencil, Plus } from '../components/ui/icons'

// #629: the glossary. Everyone signed in reads it: the words this instance's
// apps use, grouped by app, then the instance's own. An editor (a write grant
// on Glossary Term) adds and rewords terms in the ordinary form, and may take
// an app's newer wording back for a term reworded here.

function TermCard({ term, canEdit }: { term: GlossaryTerm; canEdit: boolean }) {
  const qc = useQueryClient()
  const take = useMutation({
    mutationFn: () => api.post('/api/glossary/take_app_wording', { id: term.id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: GLOSSARY_QUERY_KEY }),
  })
  return (
    <Card id={termAnchor(term.id)} data-testid="glossary-term" className="scroll-mt-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h3 className="min-w-0 text-base font-semibold text-ink [overflow-wrap:anywhere]">{term.term}</h3>
        <div className="flex items-center gap-2">
          {term.editedHere && <StatusPill tone="neutral">Edited here</StatusPill>}
          {canEdit && (
            <Link
              to="/featherbase/admin/$table/$name"
              params={{ table: GLOSSARY_TABLE, name: term.id }}
              search={{ prefill: undefined }}
              aria-label={`Edit ${term.term}`}
              className="inline-flex min-h-8 items-center gap-1 text-sm text-action underline underline-offset-2 max-sm:min-h-11"
            >
              <Pencil aria-hidden size={14} />
              Edit
            </Link>
          )}
        </div>
      </div>
      <p className="mt-1 text-sm text-ink [overflow-wrap:anywhere]">{term.definition}</p>
      {term.appWordingChanged && (
        <Notice tone="caution" className="mt-3">
          <p>The app's wording has changed.</p>
          {canEdit && (
            <Button variant="secondary" className="mt-2" loading={take.isPending} onClick={() => take.mutate()}>
              Take the app's wording
            </Button>
          )}
          {take.isError && <p className="mt-1 text-negative">The app's wording could not be taken. Try again.</p>}
        </Notice>
      )}
      {(term.examples.length > 0 || term.avoid.length > 0 || term.describes.length > 0) && (
        <dl className="mt-3 space-y-2 text-sm">
          {term.examples.length > 0 && (
            <div>
              <dt className="font-medium text-ink">Examples</dt>
              <dd>
                <ul className="list-disc space-y-0.5 pl-5 text-ink-muted">
                  {term.examples.map((example) => <li key={example} className="[overflow-wrap:anywhere]">{example}</li>)}
                </ul>
              </dd>
            </div>
          )}
          {term.avoid.length > 0 && (
            <div>
              <dt className="font-medium text-ink">Avoid</dt>
              <dd>
                <ul className="list-disc space-y-0.5 pl-5 text-ink-muted">
                  {term.avoid.map((a) => (
                    <li key={a.word} className="[overflow-wrap:anywhere]">{a.reason ? `${a.word}: ${a.reason}` : a.word}</li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {term.describes.length > 0 && (
            <div>
              <dt className="font-medium text-ink">Describes</dt>
              <dd className="flex flex-wrap gap-x-3">
                {term.describes.map((d) => (
                  <Link
                    key={`${d.table}.${d.column ?? ''}`}
                    to="/featherbase/admin/$table"
                    params={{ table: d.table }}
                    search={{ filters: undefined }}
                    className="inline-flex min-h-8 items-center text-action underline underline-offset-2 [overflow-wrap:anywhere] max-sm:min-h-11"
                  >
                    {d.column ? `${d.table}, ${d.columnLabel ?? d.column}` : d.table}
                  </Link>
                ))}
              </dd>
            </div>
          )}
        </dl>
      )}
    </Card>
  )
}

export function GlossaryPage() {
  const glossary = useGlossary()
  const [query, setQuery] = useState('')
  const hash = useRouterState({ select: (s) => s.location.hash })
  const data = glossary.data
  const shown = (data?.terms ?? []).filter((t) => termMatches(t, query))

  // "Open in the glossary" lands on its term.
  useEffect(() => {
    if (data && hash) document.getElementById(hash)?.scrollIntoView({ block: 'start' })
  }, [data, hash])

  return (
    <div className="space-y-4" data-testid="glossary-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">{adminPageTitle('glossary')}</h1>
          <p className="text-sm text-ink-muted">The words this instance's apps use, and what they mean.</p>
        </div>
        {data?.canAdd && (
          <Link
            to="/featherbase/admin/$table/$name"
            params={{ table: GLOSSARY_TABLE, name: 'new' }}
            search={{ prefill: undefined }}
            className={buttonClasses({ variant: 'primary' })}
            data-testid="glossary-add"
          >
            <Plus aria-hidden size={18} />
            Add a term
          </Link>
        )}
      </div>
      <div>
        <label htmlFor="glossary-search" className={labelClasses()}>Search terms</label>
        <SearchInput id="glossary-search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {glossary.isPending && <Skeleton label="Loading the glossary" className="w-full" />}
      {glossary.isError && !data && (
        <Notice tone="negative">
          <p>The glossary could not be loaded.</p>
          <Button variant="secondary" className="mt-2" onClick={() => void glossary.refetch()}>Try again</Button>
        </Notice>
      )}
      {data && data.terms.length === 0 && (
        <EmptyState icon={BookOpen} title="No terms yet." body="Terms appear here when an app that brings them is installed, or when someone adds one." />
      )}
      {data && data.terms.length > 0 && shown.length === 0 && (
        <EmptyState icon={BookOpen} title={`No term matches "${query.trim()}".`} body="Try another word, or part of a word." />
      )}
      {groupTerms(shown).map((group) => (
        <section key={group.key} aria-labelledby={`glossary-group-${group.key || 'instance'}`} data-testid="glossary-group">
          <h2 id={`glossary-group-${group.key || 'instance'}`} className="mb-2 text-sm font-semibold text-ink-muted">{group.title}</h2>
          <div className="space-y-3">
            {group.terms.map((term) => <TermCard key={term.id} term={term} canEdit={data?.canEdit === true} />)}
          </div>
        </section>
      ))}
    </div>
  )
}
