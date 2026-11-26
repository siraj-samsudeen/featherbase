// Recent Chats: the person's own chats, newest first, 50 at a time with Load older conversations.
// Each chat is a record, so it is a RecordLink; for now it opens the chat's Featherbase
// record, and 2d opens it in Ask.
import { useEffect, useState } from 'react'
import { Button, DataList, fmtAgo, PageHeader, RecordLink, type DataColumn } from '@featherbase/shop-floor'
import { myChats, type ChatRow } from '../api'
import { useNavigate } from 'react-router'
import { chatPath } from '../route'
// How many chats each load brings.
const PAGE = 50

  function ChatLink({ chat }: { chat: ChatRow }) {
    const navigate = useNavigate()
    return <RecordLink table="ask.chat" 
            rowId={chat.row_id} 
            name={chat.title} 
            onNavigate={() => navigate(chatPath(chat.row_id))} />
  }

const RecentChatColumn: DataColumn<ChatRow>[] = [
  { key: 'title', header: 'Chat', phone: 'title',
    cell: (chat) => <ChatLink chat={chat} /> },
  // "just now", "2 hours ago".
  { key: 'started',
    header: 'Started',
    phone: 'status',
    cell: (chat) => <span>{fmtAgo(chat.created_at)}</span> },
]

export function RecentChats() {
  // null while the first page loads; the error's words when it could not load.
  const [chats, setChats] = useState<ChatRow[] | null>(null)
  const [error, setError] = useState<string>()
  // How many chats the person has in all, so the button shows only while some are left.
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<string>()

  function load() {
    setChats(null)
    setError(undefined)
    myChats(0, PAGE).then(
      (page) => {
        setChats(page.chats)
        setTotal(page.total)
      },
      (failure: Error) => setError(failure.message),
    )
  }

  // The next 50, after the ones already shown. A chat started since the first load moves
  // the rest down by one, so one may come again: it is shown once.
  function loadMore() {
    const shown = chats ?? []
    setLoadingMore(true)
    setMoreError(undefined)
    myChats(shown.length, PAGE)
      .then(
        (page) => {
          const known = new Set(shown.map((chat) => chat.row_id))
          setChats([...shown, ...page.chats.filter((chat) => !known.has(chat.row_id))])
          setTotal(page.total)
        },
        (failure: Error) => setMoreError(failure.message),
      )
      .finally(() => setLoadingMore(false))
  }
  // A chat's link: its page in Ask, opened in place (no reload); Ctrl+click opens a new tab.

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
        {chats && chats.length < total && (
          <div className="flex flex-col items-center gap-2">
            {moreError && <p role="alert" className="text-negative">{moreError}</p>}
            <Button onClick={loadMore} loading={loadingMore}>
              Load older conversations
            </Button>
          </div>
        )}
      </div>
    </main>
  )
}