// The chat panel beside the report: a person's conversations with the app in
// the modes they hold. Agent answers a question about the figures in the chat
// itself; Reports draws its answer on the page; Ask answers how things work
// from the help; Action sends a request for a person to review, once the
// person has confirmed it. A reviewer approves or rejects what others sent.
// The platform keeps the conversations, so they are here again on any device.
import { useCallback, useEffect, useRef, useState } from 'react'
import { chatModes, chatRequests, chatSession, chatSessions, closeChatSession, decideChatRequest, sendChat,
  type ChatMessage, type ChatMode, type ChatRequest, type ChatRequests, type ChatSession } from './api'
import { MAX_QUESTION_LENGTH, SUGGESTIONS, askFailure, type Asked, type AskResult } from './ask'
import { Figures } from './ask-panel'

type Reported = Asked & { result: AskResult }

/** What the box invites in each mode. */
export const PLACEHOLDERS: Record<ChatMode, string> = {
  agent: 'Ask about your figures',
  reports: 'Describe the report you want on the page',
  ask: 'Ask how something works',
  action: 'Say what you want reviewed',
}

/** How a request's state is said. */
export const REQUEST_STATES: Record<ChatRequest['status'], string> = { pending_review: 'Waiting for review', approved: 'Approved', rejected: 'Rejected' }
/** What the two buttons under a request about to be sent say for the person. */
export const SEND_IT = 'Yes, send it'
export const CANCEL_IT = 'No, cancel'

/** The report a Reports reply carries, for the page to draw. */
export function reportOf(content: Record<string, unknown>): Reported | undefined {
  return content.kind === 'report' && content.result ? content as unknown as Reported : undefined
}

/** When a conversation was last added to: today's by the time, an older one by the day. */
export function sessionWhen(updated: string, now = new Date()): string {
  const at = new Date(updated)
  return at.toDateString() === now.toDateString() ? at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : at.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

export function ChatPanel({ onReport }: { onReport: (report: Reported | undefined) => void }) {
  const [title, setTitle] = useState('Chat')
  // The modes this person holds; undefined until the platform has said. None, and nothing to review: there is no chat for them.
  const [modes, setModes] = useState<{ mode: ChatMode; label: string }[] | undefined>(undefined)
  const [mode, setMode] = useState<ChatMode | undefined>(undefined)
  // Whether this person reviews what others send, and what the Action mode can send.
  const [review, setReview] = useState(false)
  const [offered, setOffered] = useState<{ name: string; title: string; description: string }[]>([])
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
    let open = true
    chatModes().then((chat) => {
      if (!open) return
      setTitle(chat.title)
      setModes(chat.modes)
      setMode(chat.modes[0]?.mode)
      setReview(chat.review === true)
      setOffered(chat.requests ?? [])
      // A person who only reviews has nothing to say here: they are shown what is waiting.
      if (!chat.modes.length && chat.review) showRequests()
    }, () => { if (open) setModes([]) })
    return () => { open = false }
  }, [showRequests])
  // The latest message stays in view.
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [messages, pending])

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
  const open = useCallback((id: number) => {
    chatSession(id).then((got) => { setSession(got.session); setMessages(got.messages); setSessions(undefined) }, failed)
  }, [failed])
  const close = useCallback((id: number) => {
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
    <aside className="fd-chat" data-testid="chat-panel" aria-label={title}>
      <header className="fd-chat-head">
        <h2 className="fd-chat-title">{sessions ? 'Sessions' : requests ? 'Requests' : session?.title ?? title}</h2>
        {mode && <button type="button" className="fd-chat-tool" data-testid="chat-new" title="New chat" aria-label="New chat" onClick={startNew}>+</button>}
        {(review || offered.length > 0) && !requests
          && <button type="button" className="fd-chat-tool" data-testid="chat-requests" onClick={showRequests}>Requests</button>}
        {mode && (listing
          ? <button type="button" className="fd-chat-tool" data-testid="chat-back" onClick={() => { setSessions(undefined); setRequests(undefined) }}>Back</button>
          : <button type="button" className="fd-chat-tool" data-testid="chat-sessions" onClick={showSessions}>Sessions</button>)}
      </header>

      {sessions ? (
        <ul className="fd-chat-sessions" data-testid="chat-session-list">
          {sessions.length === 0 && <li className="fd-muted">No conversations yet.</li>}
          {sessions.map(item => (
            <li key={item.id} className="fd-chat-session">
              <button type="button" className="fd-chat-session-open" data-testid="chat-session" onClick={() => open(item.id)}>
                <span className="fd-chat-session-title">{item.title}</span>
                <span className="fd-muted fd-chat-session-when">{sessionWhen(item.updated_at)}</span>
              </button>
              <button type="button" className="fd-chat-tool" data-testid="chat-session-close" title="Remove" aria-label={`Remove ${item.title}`} onClick={() => close(item.id)}>×</button>
            </li>
          ))}
        </ul>
      ) : requests ? (
        <div className="fd-chat-requests" data-testid="chat-request-list">
          {requests.review && (
            <section data-testid="chat-review">
              <h3 className="fd-chat-heading">Waiting for your review</h3>
              {requests.review.length === 0 && <p className="fd-muted">Nothing is waiting.</p>}
              {requests.review.map(item => (
                <div key={item.id} className="fd-chat-request" data-testid="chat-review-item">
                  <RequestLines request={item} />
                  <input className="fd-chat-note" data-testid="chat-review-note" maxLength={300} placeholder="A note for the sender (optional)" aria-label={`Note on ${item.ticket}`}
                    value={notes[item.id] ?? ''} onChange={event => setNotes(current => ({ ...current, [item.id]: event.target.value }))} />
                  <div className="fd-chat-actions">
                    <button type="button" className="fd-button fd-button-primary" data-testid="chat-approve" onClick={() => decide(item.id, 'approved')}>Approve</button>
                    <button type="button" className="fd-button" data-testid="chat-reject" onClick={() => decide(item.id, 'rejected')}>Reject</button>
                  </div>
                </div>
              ))}
            </section>
          )}
          <section data-testid="chat-mine">
            <h3 className="fd-chat-heading">Sent by you</h3>
            {requests.mine.length === 0 && <p className="fd-muted">You have not sent any requests.</p>}
            {requests.mine.map(item => <div key={item.id} className="fd-chat-request" data-testid="chat-mine-item"><RequestLines request={item} /></div>)}
          </section>
        </div>
      ) : (
        <div className="fd-chat-messages" aria-live="polite">
          {messages.length === 0 && !busy && (
            <div className="fd-chat-empty" data-testid="chat-empty">
              <p className="fd-muted">Chat with {title}. Pick a mode below, then ask.</p>
              {(mode === 'agent' || mode === 'reports') && SUGGESTIONS.map(question => (
                <button key={question} type="button" className="fd-link" data-testid="chat-suggestion" onClick={() => void send(question)}>{question}</button>
              ))}
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

      {failure && <p className="fd-chat-failure" data-testid="chat-failure">{failure}</p>}
      {mode && (
        <form className="fd-chat-form" onSubmit={(event) => { event.preventDefault(); void send(text) }}>
          <textarea className="fd-chat-input" data-testid="chat-input" rows={2} maxLength={MAX_QUESTION_LENGTH} aria-label={PLACEHOLDERS[mode]}
            placeholder={`${PLACEHOLDERS[mode]} · ${title}`} value={text} onChange={event => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(text) } }} />
          <div className="fd-chat-bar">
            <div className="fd-chat-modes" role="radiogroup" aria-label="Mode">
              {modes.map(item => (
                <button key={item.mode} type="button" role="radio" aria-checked={item.mode === mode} data-testid={`chat-mode-${item.mode}`}
                  className={`fd-chat-mode${item.mode === mode ? ' fd-chat-mode-on' : ''}`} onClick={() => setMode(item.mode)}>{item.label}</button>
              ))}
            </div>
            <button type="submit" className="fd-button fd-button-primary" data-testid="chat-send" disabled={busy || !text.trim()}>Send</button>
          </div>
        </form>
      )}
    </aside>
  )
}

// A request as it is listed: its number and what it is, where it stands, and what was said in it.
function RequestLines({ request }: { request: ChatRequest }) {
  return (
    <>
      <p className="fd-chat-request-head">
        <strong>{request.ticket}</strong> {request.title}
        <span className={`fd-chat-state fd-chat-state-${request.status}`} data-testid="chat-request-state">{REQUEST_STATES[request.status]}</span>
      </p>
      {request.requester && <p className="fd-muted">From {request.requester} · {sessionWhen(request.at)}</p>}
      <Inputs inputs={request.inputs} />
      {request.note && <p className="fd-muted" data-testid="chat-request-note">Reviewer’s note: {request.note}</p>}
    </>
  )
}

function Inputs({ inputs }: { inputs: { name: string; label: string; value: string }[] }) {
  return (
    <dl className="fd-chat-inputs">
      {inputs.map(input => <div key={input.name}><dt>{input.label}</dt><dd>{input.value}</dd></div>)}
    </dl>
  )
}

function Message({ message, onReport, onAnswer }: { message: ChatMessage; onReport: (report: Reported) => void; onAnswer?: (said: string) => void }) {
  const { content } = message
  if (message.role === 'user') return <p className="fd-chat-said" data-testid="chat-said">{String(content.text ?? '')}</p>
  const report = reportOf(content)
  const sources = Array.isArray(content.sources) ? content.sources as { source: string; heading: string }[] : []
  const sent = Array.isArray(content.requests) ? content.requests as ChatRequest[] : []
  return (
    <div className={`fd-chat-reply${content.kind === 'refused' ? ' fd-chat-refused' : ''}`} data-testid="chat-reply" data-kind={String(content.kind)}>
      {report ? (
        <p>
          The report is on the page: “{report.question}”.{' '}
          <button type="button" className="fd-link" data-testid="chat-show-report" onClick={() => onReport(report)}>Show it again</button>
        </p>
      ) : (
        <>
          {content.kind === 'confirm' && <p><strong>{String(content.title)}</strong></p>}
          {content.kind === 'confirm' && <Inputs inputs={content.inputs as ChatRequest['inputs']} />}
          {typeof content.text === 'string' && <p className="fd-chat-text">{content.text}</p>}
          {content.kind === 'confirm' && onAnswer && (
            <div className="fd-chat-actions">
              <button type="button" className="fd-button fd-button-primary" data-testid="chat-confirm" onClick={() => onAnswer(SEND_IT)}>Send request</button>
              <button type="button" className="fd-button" data-testid="chat-cancel" onClick={() => onAnswer(CANCEL_IT)}>Cancel</button>
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
