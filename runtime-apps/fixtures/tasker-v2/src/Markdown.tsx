import ReactMarkdown from 'react-markdown'

export function Markdown({ children }: { children: string }) {
  // No raw-HTML plugin; preserve react-markdown's safe URL transform.
  return <div className="tasker-markdown"><ReactMarkdown skipHtml>{children}</ReactMarkdown></div>
}
