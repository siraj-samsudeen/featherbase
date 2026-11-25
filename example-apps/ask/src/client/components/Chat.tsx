// The page panel: one chat. Empty, it shows the heading and examples; after the
// first question, each question with its answer, and the box under them.
import { useEffect, useRef, useState } from 'react'
import { askQuestion } from '../api'
import { EmptyChat } from './EmptyChat'
import { QuestionAnswer, type AnswerStatus } from './QuestionAnswer'
import { QuestionBox } from './QuestionBox'

// onNewChat: told once, when this chat is first saved, so the sidebar can list it.
export function Chat({ onNewChat }: { onNewChat?: () => void }) {
  // The box's text lives here, so an example can put a question into it.
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const [answers, setAnswers] = useState<AnswerStatus[]>([])
  // The saved chat these questions belong to: none until the first answer arrives.
  const [chat, setChat] = useState<string>()
  const end = useRef<HTMLDivElement>(null)
  const busy = answers.some((answer) => answer.status === 'thinking')

  // Keep the newest question in view. The braces matter: scrollIntoView returns a
  // Promise in Chromium, and React would call a returned value as a cleanup.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [answers])

  // An example only fills the box; the box is the one way to send.
  function pick(example: string) {
    setText(example)
    box.current?.focus()
  }

  // Ask the server, then put the answer, or what went wrong, in place of "Thinking…".
  async function fetchAnswer(id: string, question: string) {
    const settle = (done: AnswerStatus) =>
      setAnswers((all) => all.map((answer) => (answer.id === id ? done : answer)))
    try {
      const asked = await askQuestion(question, chat)
      // The first answer saved a new chat: the sidebar shows it at the top.
      if (!chat) onNewChat?.()
      setChat(asked.chat)
      settle({ id, question, status: 'answered', reply: asked.answer })
    } catch (error) {
      settle({ id, question, status: 'failed', error: error instanceof Error ? error.message : 'Ask could not answer. Please try again.' })
    }
  }

  // Every new question is sent from the box: it goes at the end, thinking.
  function ask(question: string) {
    if (busy) return
    const id = crypto.randomUUID()
    setAnswers((all) => [...all, { id, question, status: 'thinking' }])
    fetchAnswer(id, question)
  }

  // Try again: the failed question thinks again where it is, and is asked again.
  function retry(failed: AnswerStatus) {
    if (busy) return
    const { id, question } = failed
    setAnswers((all) => all.map((answer) => (answer.id === id ? { id, question, status: 'thinking' } : answer)))
    fetchAnswer(id, question)
  }

  const questionBox = <QuestionBox ref={box} text={text} onTextChange={setText} onAsk={ask} busy={busy} />

  if (answers.length === 0)
    return (
      <main className="ask-page">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 p-6">
          <EmptyChat onPick={pick} />
          {questionBox}
        </div>
      </main>
    )

  return (
    <main className="ask-page">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ol aria-label="Conversation" className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6">
          {answers.map((answer) => (
            <QuestionAnswer key={answer.id} answer={answer} onRetry={() => retry(answer)} busy={busy} />
          ))}
        </ol>
        <div ref={end} />
      </div>
      <div className="mx-auto w-full max-w-3xl px-6 pb-6">{questionBox}</div>
    </main>
  )
}