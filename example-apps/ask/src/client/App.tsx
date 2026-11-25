// The whole application. The router turns Ask's links into page changes without a
// reload; Ask lives at /ask/, so every address in the app is under it.
import { BrowserRouter } from 'react-router'
import { HomePage } from './components/HomePage'

export function App() {
  return (
    <BrowserRouter basename="/ask">
      <HomePage />
    </BrowserRouter>
  )
}
