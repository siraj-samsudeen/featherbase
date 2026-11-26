// The whole application. The router turns Ask's links into page changes without a
// reload; Ask lives at /ask/, so every address in the app is under it.
import { BrowserRouter } from 'react-router'
import { RecordPagesProvider } from '@featherbase/shop-floor'
import { HomePage } from './components/HomePage'
import { chatPath } from './route'

const askPageFor = 
(table: string, rowId: string) => 
  (table === 'ask.chat' ? `/ask${chatPath(rowId)}` : undefined)
export function App() {
  return (
    <BrowserRouter basename="/ask">
      <RecordPagesProvider pageFor={askPageFor}>
        <HomePage />
      </RecordPagesProvider>
    </BrowserRouter>
  )
}
