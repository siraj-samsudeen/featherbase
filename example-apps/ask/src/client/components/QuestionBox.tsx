// The question box: the one place a question is sent from.
// Enter sends; Shift+Enter starts a new line. Ask stays disabled until there is text.
import type { KeyboardEvent, Ref, SubmitEvent } from 'react'
import { ArrowUp } from '@featherbase/shop-floor'
import { MAX_QUESTION_LENGTH } from '../../shared/reply'

export function QuestionBox({ ref, text, onTextChange, onAsk }: {
  ref?: Ref<HTMLTextAreaElement>
  text: string
  onTextChange: (text: string) => void
  onAsk: (question: string) => void
}) {
  // Spaces and empty lines alone are not a question.
  const question = text.trim()

  function send() {
    if (!question) return
    onAsk(question)
    onTextChange('')
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    send()
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Shift+Enter is left alone, so the text area adds a new line.
    // isComposing: an Enter that picks a word in an input method (Tamil, Japanese…) is not a send.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  return (
    // One rounded box holds the text and the send button, like ChatGPT's.
    // The focus ring goes on the whole box, not on the text area inside it.
    <form
      onSubmit={submit}
      className="flex items-end gap-2 rounded-3xl bg-fill p-2 pl-5 focus-within:outline-[1.5px] focus-within:outline-focus"
    >
      <textarea
        ref={ref}
        aria-label="Your question"
        placeholder="Ask about your data, your Tables or Featherbase"
        rows={1}
        maxLength={MAX_QUESTION_LENGTH}
        autoFocus
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        onKeyDown={keyDown}
        // field-sizing-content: the box grows with the text, up to max-h-52, then scrolls.
        className="field-sizing-content max-h-52 min-h-6 flex-1 resize-none self-center bg-transparent py-1.5 text-base text-ink outline-none placeholder:text-ink-subtle"
      />
      <button
        type="submit"
        aria-label="Ask"
        title="Ask"
        disabled={!question}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-action text-action-ink hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ArrowUp aria-hidden="true" size={18} />
      </button>
    </form>
  )
}
