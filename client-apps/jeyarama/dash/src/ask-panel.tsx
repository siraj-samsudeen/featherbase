// How an answer about the figures is drawn: the report's own table, how
// recent the figures are, whose they are, and how they were worked out. The
// chat panel draws an Agent answer with it; the page draws a report with it.
// #1353: on Shop Floor's card and button; the table is the quick view's own (.fd-table), so an answer
// reads as the report does.
import { Button, cardClasses } from '@featherbase/shop-floor'
import { answerDataLine, cell, columnLabel, coversLine, definitionLines, unmatchedLine, type Asked, type AskResult } from './ask'

/** A report asked for in the chat, drawn on the page above the store's own report. */
export function ReportAnswer({ report, onClose }: { report: Asked & { result: AskResult }; onClose: () => void }) {
  return (
    <section className={cardClasses('fd-ask p-4')} data-testid="report-answer">
      <div className="fd-ask-head">
        <h2 className="fd-ask-question">{report.question}</h2>
        <Button variant="quiet" data-testid="report-close" onClick={onClose}>Close</Button>
      </div>
      <Figures result={report.result} sql={report.sql} />
      <p className="fd-muted fd-small">Asked in FeatherBot, in Reports.</p>
    </section>
  )
}

export function Figures({ result, sql }: { result: AskResult; sql?: string }) {
  const definitions = definitionLines(result.columns)
  return (
    <>
      {(result.unmatched ?? []).map((miss) => <p key={`${miss.dimension}:${miss.value}`} data-testid="ask-unmatched">{unmatchedLine(miss)}</p>)}
      {result.rows.length === 0 && <p data-testid="ask-nothing">Nothing matched that question.</p>}
      {result.rows.length > 0 && (
        <div className="fd-table-box">
          <table className="fd-table">
            <thead>
              <tr>{result.columns.map((column) => (
                <th key={column.name} scope="col" className={column.kind === 'dimension' ? undefined : 'fd-num'}>{columnLabel(column.name)}</th>
              ))}</tr>
            </thead>
            <tbody>
              {result.rows.map((row, index) => (
                <tr key={index}>
                  {result.columns.map((column, at) => {
                    const { text, numeric, negative } = cell(column, row[at])
                    return at === 0 && column.kind === 'dimension'
                      ? <th key={column.name} scope="row" className="fd-sub">{text}</th>
                      : <td key={column.name} className={`${numeric ? 'fd-num' : ''}${negative ? ' fd-negative' : ''}`}>{text}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.truncated && <p className="fd-muted fd-small">Showing the first {result.rows.length} rows.</p>}
      <p className="fd-muted fd-small" data-testid="ask-data-line">{answerDataLine(result)}</p>
      <p className="fd-muted fd-small" data-testid="ask-covers">{coversLine(result.places)}</p>
      {(definitions.length > 0 || sql) && (
        <details className="fd-small" data-testid="ask-definitions">
          <summary>How These Figures Were Worked Out</summary>
          {definitions.length > 0 && <ul className="fd-ask-definitions">{definitions.map((line) => <li key={line}>{line}</li>)}</ul>}
          {sql && <pre className="fd-ask-sql" data-testid="ask-sql">{sql}</pre>}
        </details>
      )}
    </>
  )
}
