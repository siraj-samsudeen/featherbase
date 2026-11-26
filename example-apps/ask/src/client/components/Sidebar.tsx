// Ask's rows in the platform's sidebar, as ChatGPT's: New chat, then the "Recent Chats ⌄"
// heading (its words and ⌄ open and close the person's newest chats; its ↗ opens the page of every
// chat), the chats as plain one-line rows, and Load older conversations. Collapsed to
// icons: New chat, and one icon that opens the Recent Chats page (no list, no menu).
// The rows are the router's links: no reload, and Ctrl+click opens a new tab.
import { createElement, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowUpRight, ChevronDown, History, Plus, useRecordHref } from '@featherbase/shop-floor'
import { myChats, type ChatRow } from '../api'
import { MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import { chatPath } from '../route'
export type Page = 'chat' | 'chats'

// How many chats the sidebar loads at a time.
const PAGE = 20

// How long ago, short, as the platform's Recently Opened writes it: now, 5m, 3h, 2d.
function shortAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / 1440)}d`
}

// One chat as a sidebar row: its title on one line, cut with "…", and on the right how long
// ago it started. A chat is a record, so the row goes where its record link goes: the
// chat's page in Ask. A plain click opens it in place; Ctrl+click is left to the browser.
function ChatRowLink({ chat, active }: { chat: ChatRow; active: boolean }) {
  const href = useRecordHref('ask.chat', chat.row_id)
  const navigate = useNavigate()
  const when = shortAgo(chat.created_at)
  function open(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(chatPath(chat.row_id))
  }
  return (
    <a
      href={href}
      onClick={open}
      aria-current={active ? 'page' : undefined}
      title={`${chat.title} · started ${when === 'now' ? 'just now' : `${when} ago`}`}
    >
      <span className="min-w-0 flex-1 truncate">{chat.title}</span>
      <span className="shrink-0 text-xs tabular-nums text-ink-subtle">{when}</span>
    </a>
  )
}

// `saved` goes up each time a new chat is saved, so the list loads again with it on top.
export function Sidebar({ page, opened, saved }: { page: Page; opened?: string ;saved: number }) {
  const [chats, setChats] = useState<ChatRow[]>([])
  const [total, setTotal] = useState(0)
  const [failed, setFailed] = useState(false)
  // The heading opens and closes the list, like ChatGPT's Recents.
  const [open, setOpen] = useState(true)
  // The platform marks its sidebar data-collapsed when it is folded to icons.
  const sidebar = useRef<HTMLElement>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const element = sidebar.current
    if (!element) return
    const follow = () => setCollapsed(element.hasAttribute('data-collapsed'))
    follow()
    const watch = new MutationObserver(follow)
    watch.observe(element, { attributes: true, attributeFilter: ['data-collapsed'] })
    return () => watch.disconnect()
  }, [])

  function load() {
    setFailed(false)
    myChats(0, PAGE).then(
      (first) => {
        setChats(first.chats)
        setTotal(first.total)
      },
      () => setFailed(true),
    )
  }

  // The next 20 after those shown; a chat that comes again is shown once.
  function loadOlder() {
    myChats(chats.length, PAGE).then(
      (next) => {
        const known = new Set(chats.map((chat) => chat.row_id))
        setChats([...chats, ...next.chats.filter((chat) => !known.has(chat.row_id))])
        setTotal(next.total)
      },
      () => setFailed(true),
    )
  }

  useEffect(load, [saved])

  // The chats show when the list is open, the sidebar is not folded to icons, and the
  // page is not Recent Chats itself (which lists them all).
  const showChats = open && !collapsed && page !== 'chats'

  // featherbase-sidebar is the platform's own element: the app supplies only its rows.
  return createElement(
    'featherbase-sidebar',
    { ref: sidebar, className: 'ask-sidebar', 'aria-label': 'Ask' },
    <Link key="new" to="/" aria-current={page === 'chat' && !opened ? 'page' : undefined}>
      <Plus aria-hidden="true" size={18} />
      <span>New chat</span>
    </Link>,
    // The heading row: "Recent Chats" on the left opens and closes the list; on the right,
    // ↗ opens the page of every chat, then ⌄ last, which also opens and closes the list.
    // Separate controls, since a link may not sit inside a button.
    !collapsed && (
      <div key="heading" className="flex items-center gap-1 px-3 pt-3 pb-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="min-w-0 flex-1 cursor-pointer rounded-control text-left"
        >
          Recent Chats
        </button>
        <Link
          to="/?view=chats"
          title="See all chats"
          aria-label="See all chats"
          aria-current={page === 'chats' ? 'page' : undefined}
          className="grid size-6 place-items-center rounded-control hover:bg-border/50 hover:text-ink aria-[current=page]:text-action"
        >
          <ArrowUpRight aria-hidden="true" size={14} />
        </Link>
        {/* The same toggle as the words, for the mouse; the keyboard and screen readers use the words. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          title={open ? 'Hide recent chats' : 'Show recent chats'}
          onClick={() => setOpen(!open)}
          className="grid size-6 cursor-pointer place-items-center rounded-control hover:bg-border/50 hover:text-ink"
        >
          <ChevronDown size={14} className={open ? '' : '-rotate-90'} />
        </button>
      </div>
    ),
    ...(showChats ? chats.map((chat) => <ChatRowLink key={chat.row_id} chat={chat} active={chat.row_id===opened} />) : []),
    showChats && failed && (
      <button key="retry" type="button" onClick={load}>
        <span>Chats could not load. Try again</span>
      </button>
    ),
    showChats && !failed && chats.length < total && (
      <button key="older" type="button" onClick={loadOlder}>
        <span>Load older conversations</span>
      </button>
    ),
    // Collapsed, the list is gone, so one icon still opens the page of every chat.
    collapsed && (
      <Link key="rail-chats" to="/?view=chats" aria-current={page === 'chats' ? 'page' : undefined}>
        <History aria-hidden="true" size={18} />
        <span>Recent Chats</span>
      </Link>
    ),
  )
}
