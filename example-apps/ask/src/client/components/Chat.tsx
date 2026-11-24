// The page panel: one chat. For now the empty chat and the box; 3d adds the turns.
import { useRef, useState } from 'react'
import { EmptyChat } from './EmptyChat'
import { QuestionBox } from './QuestionBox'

export function Chat() {
  // The box's text lives here, so an example can put a question into it.
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)

  // An example only fills the box; the box is the one way to send.
  function pick(example: string) {
    setText(example)
    box.current?.focus()
  }

  // Every question is sent from the box. 3d sends it to the server and shows the answer.
  function ask(_question: string) {}

  return (
    <main className="ask-page">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 p-6">
        <EmptyChat onPick={pick} />
        <QuestionBox ref={box} text={text} onTextChange={setText} onAsk={ask} />
      </div>
    </main>
  )
}
