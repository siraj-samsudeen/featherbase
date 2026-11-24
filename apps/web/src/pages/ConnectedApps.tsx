import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, EmptyState, Notice, fmtAgo, fmtDate, timelineDayKey } from '@featherbase/shop-floor'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { usePageTitle } from '../lib/page-title'
import { returnPlaceText } from './AgentConnect'

// mcp-oauth-connect (#1207, items 10-11): the agents the signed-in person
// connected, each until they disconnect it (or it goes unused for 30 days).

interface Connection {
  id: string
  client_name: string
  return_place: string
  created_at: string
  last_used_at: string
}

/** The reader's own calendar day of an instant, as DD-Mon-YYYY. */
const day = (iso: string) => fmtDate(timelineDayKey(new Date(iso)))

export function ConnectedApps() {
  const { t } = useI18n()
  usePageTitle('Connected Apps')
  const qc = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ['agent-connections'],
    queryFn: () => api.get<{ connections: Connection[] }>('/api/agent-connections'),
  })
  const disconnect = useMutation({
    mutationFn: (id: string) => api.delete(`/api/agent-connections/${encodeURIComponent(id)}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['agent-connections'] }),
  })
  const disconnectAfterAsking = (c: Connection) => {
    if (window.confirm(`Disconnect “${c.client_name}”? It will stop working until you connect it again.`)) disconnect.mutate(c.id)
  }
  const address = `${window.location.origin}/mcp`
  const [copy, setCopy] = useState<'idle' | 'copied' | 'refused'>('idle')

  return (
    <div className="space-y-4" data-testid="connected-apps">
      <h1 className="pb-2 text-2xl font-semibold text-ink">{t('Connected Apps')}</h1>
      {error && <Notice tone="negative">{error.message}</Notice>}
      {disconnect.error && <Notice tone="negative">{disconnect.error.message}</Notice>}
      {data && (
        <Card className="divide-y divide-border">
          {data.connections.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid={`connection-${c.id}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">“{c.client_name}”</p>
                <p className="truncate text-sm text-ink-muted">
                  Returns to {returnPlaceText(c.return_place)} · Connected {day(c.created_at)} · Last used {fmtAgo(c.last_used_at)}
                </p>
              </div>
              <Button disabled={disconnect.isPending} onClick={() => disconnectAfterAsking(c)}>Disconnect</Button>
            </div>
          ))}
          {data.connections.length === 0 && (
            <div data-testid="connected-apps-empty">
              <EmptyState
                title="No agents connected."
                body={
                  <>
                    To connect one, give your agent this address: <code className="select-all font-mono text-ink">{address}</code>
                  </>
                }
                action={
                  <div className="flex flex-col items-center gap-2">
                    <Button
                      onClick={() => void navigator.clipboard.writeText(address).then(() => setCopy('copied'), () => setCopy('refused'))}
                    >
                      {copy === 'copied' ? 'Copied ✓' : 'Copy'}
                    </Button>
                    {copy === 'refused' && (
                      <p className="text-sm text-negative" data-testid="copy-address-refused">
                        Copying was blocked. Select the address and copy it yourself.
                      </p>
                    )}
                  </div>
                }
              />
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
