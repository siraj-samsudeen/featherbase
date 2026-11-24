// One question and its answer. Until the answer arrives it shows "Thinking…";
// if the call fails, it shows what went wrong.
import type { Reply } from '../../shared/reply'

// Where a question's answer stands: on its way, arrived, or failed.
export type AnswerStatus =
  | { id: string; question: string; status: 'thinking' }
  | { id: string; question: string; status: 'answered'; reply: Reply }
  | { id: string; question: string; status: 'failed'; error: string }

export function QuestionAnswer({ answer }: { answer: AnswerStatus }) {
  return (
    <li className="flex flex-col gap-3">
      <p className="max-w-[80%] self-end whitespace-pre-wrap rounded-control bg-action-tint px-4 py-2 text-ink">
        {answer.question}
      </p>
      {answer.status === 'thinking' && (
        <p role="status" className="text-ink-subtle">
          Thinking…
        </p>
      )}
      {answer.status === 'answered' && <p className="whitespace-pre-wrap text-ink">
        {answer.reply.text}
        </p>}
      {answer.status === 'failed' && (
        <p role="alert" className="text-negative">
          {answer.error}
        </p>
      )}
    </li>
  )
}