// One question and its answer. Until the answer arrives it shows "Thinking…";
// if the call fails, it shows what went wrong and a button to ask again.
import { Button, Notice } from '@featherbase/shop-floor'
import type { Reply } from '../../shared/reply'

// Where a question's answer stands: on its way, arrived, or failed.
export type AnswerStatus =
  | { id: string; question: string; status: 'thinking' }
  | { id: string; question: string; status: 'answered'; reply: Reply }
  | { id: string; question: string; status: 'failed'; error: string }

export function QuestionAnswer({ answer, onRetry, busy = false }: {
  answer: AnswerStatus
  // Asks the same question again, in the same place.
  onRetry: () => void
  // Another answer is on its way: Try again waits for it, as the box does.
  busy?: boolean
}) {
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
      {answer.status === 'answered' && <p className="whitespace-pre-wrap text-ink">{answer.reply.text}</p>}
      {answer.status === 'failed' && (
        // Shop Floor's failure, as its lists show it: a red notice with Try again (DataList).
        <Notice tone="negative">
          <p>{answer.error}</p>
          <Button className="mt-2" onClick={onRetry} disabled={busy}>
            Try again
          </Button>
        </Notice>
      )}
    </li>
  )
}
