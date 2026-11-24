// The page panel: one chat. For now the empty chat and the box; 3d adds the turns.
import { EmptyChat } from './EmptyChat'
import { QuestionBox } from './QuestionBox'

export function Chat() {
  // Every question goes through here, from the box or an example.
  // 3d sends it to the server and shows the answer; until then it does nothing.
  function ask(_question: string) {}

  return (
    <main className="ask-page">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 p-6">
        <EmptyChat onAsk={ask} />
        <QuestionBox onAsk={ask} />
      </div>
    </main>
  )
}
