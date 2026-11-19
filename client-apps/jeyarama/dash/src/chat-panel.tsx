// #1353: FeatherBot, the chat on a report: a button on the report's header line beside "Report an
// issue" that opens the same side panel. A person talks to the app in the modes they hold. Agent
// answers a question about the figures in the chat itself; Reports draws its answer on the page; Ask
// answers how things work from the help; Action sends a request for a person to review, once the
// person has confirmed it. A reviewer approves or rejects what others sent. The platform keeps the
// conversations, so they are here again on any device.
//
// Built from Shop Floor (Button, Segmented, Notice, StatusPill, EmptyState, the input classes and the
// date format) and Dash's own person line, never from controls of its own.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, EmptyState, History, Inbox, Notice, Plus, Segmented, StatusPill, X, fmtDateTime, iconButtonClasses, inputClasses, type StatusTone } from '@featherbase/shop-floor'
import { chatModes, chatRequests, chatSession, chatSessions, closeChatSession, decideChatRequest, sendChat,
  type ChatMessage, type ChatMode, type ChatRequest, type ChatRequests, type ChatSession } from './api'
import { MAX_QUESTION_LENGTH, SUGGESTIONS, askFailure, type Asked, type AskResult } from './ask'
import { Figures } from './ask-panel'
import { PersonName } from './person-identity'

type Reported = Asked & { result: AskResult }

/** What the box invites in each mode. */
export const PLACEHOLDERS: Record<ChatMode, string> = {
  agent: 'Ask about your figures',
  reports: 'Describe the report you want on the page',
  ask: 'Ask how something works',
  action: 'Say what you want reviewed',
}

/** How a request's state is said, and the tone that repeats it. */
export const REQUEST_STATES: Record<ChatRequest['status'], string> = { pending_review: 'Waiting For Review', approved: 'Approved', rejected: 'Rejected' }
const REQUEST_TONES: Record<ChatRequest['status'], StatusTone> = { pending_review: 'caution', approved: 'positive', rejected: 'negative' }
/** What the two buttons under a request about to be sent say for the person. */
export const SEND_IT = 'Yes, send it'
export const CANCEL_IT = 'No, cancel'

/** The report a Reports reply carries, for the page to draw. */
export function reportOf(content: Record<string, unknown>): Reported | undefined {
  return content.kind === 'report' && content.result ? content as unknown as Reported : undefined
}

/** When a conversation was last added to, or a request sent: the day and time, as every Dash screen writes them. */
export const chatWhen = (at: string): string => fmtDateTime(new Date(at))

export function ChatPanel({ onReport }: { onReport: (report: Reported | undefined) => void }) {
  const [title, setTitle] = useState('Chat')
  // The modes this person holds; undefined until the platform has said. None, and nothing to review: there is no chat for them.
  const [modes, setModes] = useState<{ mode: ChatMode; label: string }[] | undefined>(undefined)
  const [mode, setMode] = useState<ChatMode | undefined>(undefined)
  // Whether this person reviews what others send, and what the Action mode can send.
  const [review, setReview] = useState(false)
  const [offered, setOffered] = useState<{ name: string; title: string; description: string }[]>([])
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState<ChatSession | undefined>(undefined)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // The list of conversations, or the requests, when on show in place of the conversation.
  const [sessions, setSessions] = useState<ChatSession[] | undefined>(undefined)
  const [requests, setRequests] = useState<ChatRequests | undefined>(undefined)
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [text, setText] = useState('')
  // What was just said, shown until the platform has answered it.
  const [pending, setPending] = useState<string | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const end = useRef<HTMLDivElement>(null)

  const failed = useCallback((error: unknown) => setFailure(askFailure(error)), [])
  const showRequests = useCallback(() => {
    setFailure(undefined)
    setSessions(undefined)
    chatRequests().then(setRequests, failed)
  }, [failed])

  useEffect(() => {
    let live = true
    chatModes().then((chat) => {
      if (!live) return
      setTitle(chat.title)
      setModes(chat.modes)
      setMode(chat.modes[0]?.mode)
      setReview(chat.review === true)
      setOffered(chat.requests ?? [])
      // A person who only reviews has nothing to say here: they are shown what is waiting.
      if (!chat.modes.length && chat.review) showRequests()
    }, () => { if (live) setModes([]) })
    return () => { live = false }
  }, [showRequests])
  // The latest message stays in view.
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [messages, pending, open])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const send = useCallback(async (said: string, as: ChatMode | undefined = mode) => {
    const asked = said.trim()
    if (!asked || !as || pending !== undefined) return
    setPending(asked)
    setFailure(undefined)
    setText('')
    try {
      const got = await sendChat(as, asked, session?.id)
      setSession(got.session)
      setMessages(current => [...current, ...got.messages])
      const report = reportOf(got.messages.at(-1)?.content ?? {})
      if (report) onReport(report)
    } catch (error) {
      // What was said goes back in the box, to be sent again or reworded.
      setText(asked)
      failed(error)
    } finally {
      setPending(undefined)
    }
  }, [mode, pending, session, onReport, failed])

  const startNew = useCallback(() => { setSession(undefined); setMessages([]); setSessions(undefined); setRequests(undefined); setFailure(undefined) }, [])
  const showSessions = useCallback(() => {
    setFailure(undefined)
    setRequests(undefined)
    chatSessions().then(setSessions, failed)
  }, [failed])
  const openSession = useCallback((id: number) => {
    chatSession(id).then((got) => { setSession(got.session); setMessages(got.messages); setSessions(undefined) }, failed)
  }, [failed])
  const remove = useCallback((id: number) => {
    closeChatSession(id).then((left) => {
      setSessions(left)
      if (session?.id === id) { setSession(undefined); setMessages([]) }
    }, failed)
  }, [failed, session])
  const decide = useCallback((id: number, decision: 'approved' | 'rejected') => {
    setFailure(undefined)
    decideChatRequest(id, decision, notes[id]?.trim() || undefined).then(setRequests, failed)
  }, [failed, notes])

  if (!modes || (!modes.length && !review)) return null
  const busy = pending !== undefined
  const listing = sessions !== undefined || requests !== undefined
  return (
    <>
      {/* data-action: while a tester views as someone, nothing offers to speak as them (#1222). */}
      <Button data-action variant="secondary" className="fd-chat-open" data-testid="chat-open" aria-expanded={open} onClick={() => setOpen(true)}>
        {mode ? `Ask ${title}` : 'Requests To Review'}
      </Button>
      {open && (
        <aside className="fd-issue-panel fd-chat shadow-lg" role="dialog" aria-modal="false" aria-label={title} data-testid="chat-panel">
          <header className="fd-chat-head">
            <h2 className="text-base font-semibold">{sessions ? 'Sessions' : requests ? 'Requests' : session?.title ?? title}</h2>
            {mode && <button type="button" className={iconButtonClasses()} data-testid="chat-new" title="New Chat" aria-label="New Chat" onClick={startNew}><Plus aria-hidden size={18} /></button>}
            {(review || offered.length > 0) && !requests
              && <button type="button" className={iconButtonClasses()} data-testid="chat-requests" title="Requests" aria-label="Requests" onClick={showRequests}><Inbox aria-hidden size={18} /></button>}
            {mode && !listing
              && <button type="button" className={iconButtonClasses()} data-testid="chat-sessions" title="Sessions" aria-label="Sessions" onClick={showSessions}><History aria-hidden size={18} /></button>}
            {mode && listing
              && <Button variant="quiet" data-testid="chat-back" onClick={() => { setSessions(undefined); setRequests(undefined) }}>Back</Button>}
            <button type="button" className={iconButtonClasses()} data-testid="chat-close" aria-label="Close" onClick={() => setOpen(false)}><X aria-hidden size={18} /></button>
          </header>

          {sessions ? (
            <div className="fd-chat-body" data-testid="chat-session-list">
              {sessions.length === 0 && <EmptyState title="No Conversations Yet" body="What you ask is kept here, so you can come back to it on any device." />}
              <ul className="fd-chat-list">
                {sessions.map(item => (
                  <li key={item.id} className="fd-chat-session">
                    <button type="button" className="fd-chat-session-open" data-testid="chat-session" onClick={() => openSession(item.id)}>
                      <span className="fd-chat-session-title">{item.title}</span>
                      <span className="fd-muted text-xs">{chatWhen(item.updated_at)}</span>
                    </button>
                    <button type="button" className={iconButtonClasses()} data-testid="chat-session-close" title="Remove" aria-label={`Remove ${item.title}`} onClick={() => remove(item.id)}><X aria-hidden size={16} /></button>
                  </li>
                ))}
              </ul>
            </div>
          ) : requests ? (
            <div className="fd-chat-body" data-testid="chat-request-list">
              {requests.review && (
                <section className="flex flex-col gap-2" data-testid="chat-review">
                  <h3 className="fd-issue-label">Waiting For Your Review</h3>
                  {requests.review.length === 0 && <p className="fd-muted">Nothing is waiting.</p>}
                  {requests.review.map(item => (
                    <div key={item.id} className="fd-chat-request" data-testid="chat-review-item">
                      <RequestLines request={item} />
                      <input className={inputClasses()} data-testid="chat-review-note" maxLength={300} placeholder="A note for the sender (optional)" aria-label={`Note on ${item.ticket}`}
                        value={notes[item.id] ?? ''} onChange={event => setNotes(current => ({ ...current, [item.id]: event.target.value }))} />
                      <div className="fd-chat-actions">
                        <Button variant="primary" data-testid="chat-approve" onClick={() => decide(item.id, 'approved')}>Approve</Button>
                        <Button variant="secondary" data-testid="chat-reject" onClick={() => decide(item.id, 'rejected')}>Reject</Button>
                      </div>
                    </div>
                  ))}
                </section>
              )}
              <section className="flex flex-col gap-2" data-testid="chat-mine">
                <h3 className="fd-issue-label">Sent By You</h3>
                {requests.mine.length === 0 && <p className="fd-muted">You have not sent any requests.</p>}
                {requests.mine.map(item => <div key={item.id} className="fd-chat-request" data-testid="chat-mine-item"><RequestLines request={item} /></div>)}
              </section>
            </div>
          ) : (
            <div className="fd-chat-body" aria-live="polite">
              {messages.length === 0 && !busy && (
                <div className="flex flex-col gap-3" data-testid="chat-empty">
                  <p className="fd-muted">Pick a mode below, then ask. Answers cover only the stores and sections you look after.</p>
                  {(mode === 'agent' || mode === 'reports') && (
                    <div className="fd-chat-suggestions">
                      {SUGGESTIONS.map(question => (
                        <button key={question} type="button" className="fd-chip" data-testid="chat-suggestion" onClick={() => void send(question)}>{question}</button>
                      ))}
                    </div>
                  )}
                  {mode === 'action' && offered.map(item => (
                    <p key={item.name} className="fd-muted" data-testid="chat-offered"><strong>{item.title}.</strong> {item.description}</p>
                  ))}
                  {mode === 'action' && offered.length > 0 && <p className="fd-muted">Nothing is sent until you confirm it, and a person reviews every request.</p>}
                </div>
              )}
              {messages.map((message, index) => (
                <Message key={message.id} message={message} onReport={onReport}
                  onAnswer={index === messages.length - 1 && !busy ? said => void send(said, 'action') : undefined} />
              ))}
              {busy && <p className="fd-chat-said" data-testid="chat-pending">{pending}</p>}
              {busy && <p className="fd-muted" data-testid="chat-working">Working on it…</p>}
              <div ref={end} />
            </div>
          )}

          {failure && <div className="px-5 pb-2"><Notice tone="negative"><span data-testid="chat-failure">{failure}</span></Notice></div>}
          {mode && (
            <form className="fd-chat-form" onSubmit={(event) => { event.preventDefault(); void send(text) }}>
              <textarea className={inputClasses('fd-textarea')} data-testid="chat-input" rows={2} maxLength={MAX_QUESTION_LENGTH} aria-label={PLACEHOLDERS[mode]}
                placeholder={PLACEHOLDERS[mode]} value={text} onChange={event => setText(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(text) } }} />
              <div className="fd-chat-bar">
                <Segmented label="Mode" options={modes.map(item => ({ value: item.mode, label: item.label }))} value={mode} onChange={setMode} />
                <Button variant="primary" type="submit" loading={busy} disabled={!text.trim()} data-testid="chat-send">Send</Button>
              </div>
            </form>
          )}
        </aside>
      )}
    </>
  )
}

// A request as it is listed: its number and what it is, where it stands, who sent it, and what was said in it.
function RequestLines({ request }: { request: ChatRequest }) {
  return (
    <>
      <p className="fd-chat-request-head">
        <strong>{request.ticket}</strong> {request.title}
        <StatusPill tone={REQUEST_TONES[request.status]}><span data-testid="chat-request-state">{REQUEST_STATES[request.status]}</span></StatusPill>
      </p>
      {/* The sender, as every Dash screen names a person: the name, then employee code · job · place. */}
      {request.requester && (
        <p className="text-sm" data-testid="chat-requester">
          <PersonName name={request.requester} who={request.requester_who} />
          <span className="fd-muted block text-xs">Sent {chatWhen(request.at)}</span>
        </p>
      )}
      <Inputs inputs={request.inputs} />
      {request.note && <p className="fd-muted" data-testid="chat-request-note">Reviewer’s note: {request.note}</p>}
    </>
  )
}

function Inputs({ inputs }: { inputs: { name: string; label: string; value: string }[] }) {
  return (
    <dl className="fd-chat-inputs">
      {inputs.map(input => <div key={input.name} className="contents"><dt>{input.label}</dt><dd>{input.value}</dd></div>)}
    </dl>
  )
}

function Message({ message, onReport, onAnswer }: { message: ChatMessage; onReport: (report: Reported) => void; onAnswer?: (said: string) => void }) {
  const { content } = message
  if (message.role === 'user') return <p className="fd-chat-said" data-testid="chat-said">{String(content.text ?? '')}</p>
  const report = reportOf(content)
  const sources = Array.isArray(content.sources) ? content.sources as { source: string; heading: string }[] : []
  const sent = Array.isArray(content.requests) ? content.requests as ChatRequest[] : []
  if (content.kind === 'refused')
    return <div className="fd-chat-reply" data-testid="chat-reply" data-kind="refused"><Notice tone="caution"><span className="fd-chat-text">{String(content.text ?? '')}</span></Notice></div>
  return (
    <div className="fd-chat-reply" data-testid="chat-reply" data-kind={String(content.kind)}>
      {report ? (
        <p>
          The report is on the page: “{report.question}”.{' '}
          <Button variant="quiet" data-testid="chat-show-report" onClick={() => onReport(report)}>Show It Again</Button>
        </p>
      ) : (
        <>
          {content.kind === 'confirm' && <p><strong>{String(content.title)}</strong></p>}
          {content.kind === 'confirm' && <Inputs inputs={content.inputs as ChatRequest['inputs']} />}
          {typeof content.text === 'string' && <p className="fd-chat-text">{content.text}</p>}
          {content.kind === 'confirm' && onAnswer && (
            <div className="fd-chat-actions">
              <Button variant="primary" data-testid="chat-confirm" onClick={() => onAnswer(SEND_IT)}>Send Request</Button>
              <Button variant="secondary" data-testid="chat-cancel" onClick={() => onAnswer(CANCEL_IT)}>Cancel</Button>
            </div>
          )}
          {sent.map(item => <div key={item.id} className="fd-chat-request" data-testid="chat-sent-item"><RequestLines request={item} /></div>)}
          {content.kind === 'figures' && content.result ? <Figures result={content.result as AskResult} sql={String(content.sql ?? '')} /> : null}
          {sources.length > 0 && (
            <ul className="fd-chat-sources" data-testid="chat-sources">
              {sources.map(source => <li key={`${source.source}#${source.heading}`}>{source.source} · {source.heading}</li>)}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
