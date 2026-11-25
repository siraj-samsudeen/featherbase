// Recent Chats: the person's own chats, newest first. Each chat is a record, so it is a
// RecordLink; for now it opens the chat's Featherbase record, and 2d opens it in Ask.
import { useEffect, useState } from 'react'
import { DataList, fmtAgo, PageHeader, RecordLink, type DataColumn } from '@featherbase/shop-floor'
import { myChats, type ChatRow } from '../api'

const RecentChatColumn: DataColumn<ChatRow>[] = [
  { key: 'title', header: 'Chat', phone: 'title', 
    cell: (chat) => <RecordLink table="ask.chat" rowId={chat.row_id} name={chat.title} /> },
  // "just now", "2 hours ago".
  { key: 'started', 
    header: 'Started', 
    phone: 'status', 
    cell: (chat) => <span>{fmtAgo(chat.created_at)}</span> },
]

export function RecentChats() {
  // null while loading; the error's words when the list could not load.
  const [chats, setChats] = useState<ChatRow[] | null>(null)
  const [error, setError] = useState<string>()

  function load() {
    setChats(null)
    setError(undefined)
    myChats().then((answer) => setChats(answer), (failure: Error) => setError(failure.message))
  }

  useEffect(load, [])

  return (
    <main className="ask-page">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 overflow-y-auto p-6">
        <PageHeader title="Recent Chats" status="Every chat you have had with Ask, newest first." />
        <DataList
          caption="My chats"
          rows={chats ?? []}
          state={error ? 'error' : chats ? 'ready' : 'loading'}
          error={error}
          onRetry={load}
          rowKey={(chat) => chat.row_id}
          columns={RecentChatColumn}
          empty={{ title: 'No chats yet', body: 'The chats you have with Ask show here.' }}
        />
      </div>
    </main>
  )
}