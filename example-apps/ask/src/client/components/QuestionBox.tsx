// The question box: where a person types a question and sends it.
// Enter sends; Shift+Enter starts a new line. Ask stays disabled until there is text.
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button, inputClasses } from '@featherbase/shop-floor'
import { MAX_QUESTION_LENGTH } from '../../shared/reply'

export function QuestionBox({ onAsk }: { onAsk: (question: string) => void }) {
  const [text, setText] = useState('')
  // Spaces and empty lines alone are not a question.
  const question = text.trim()

  function send() {
    if (!question) return
    onAsk(question)
    setText('')
  }

  function submit(event: FormEvent) {
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
    <form onSubmit={submit} className="flex items-end gap-2">
      <textarea
        aria-label="Your question"
        placeholder="Ask about your data, your Tables or Featherbase"
        rows={2}
        maxLength={MAX_QUESTION_LENGTH}
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={keyDown}
        className={inputClasses('resize-none py-3')}
      />
      <Button type="submit" variant="primary" disabled={!question} className="h-12 px-5">
        Ask
      </Button>
    </form>
  )
}