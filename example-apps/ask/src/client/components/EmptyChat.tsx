// What a chat shows before its first question: the heading and three examples.
// Clicking an example asks it, the same as typing it into the box.
import { Button } from '@featherbase/shop-floor'

const EXAMPLES = [
  'Did I meet my target this month?',
  'How many tickets are open right now?',
  'How do I report a wrong figure?',
]

export function EmptyChat({ onAsk }: { onAsk: (question: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <h1 className="text-2xl font-semibold text-ink">What do you want to know?</h1>
      <ul aria-label="Example questions" className="flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((example) => (
          <li key={example}>
            <Button onClick={() => onAsk(example)} className="font-normal">
              {example}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}
