// #1240: a ticket raised from a report shows where it came from, in the report's own words, with
// a link back to the view the person was looking at.
import type { RecordData } from './api'
import { REPORT_FEEDBACK_FIELDS, isLocalPath } from './report-feedback'
import { display, time } from './ticket-words'

/** Shown to whoever reads the request: the raiser and support. The report key stays out of sight. */
export function ReportFeedbackFacts({ values }: { values: RecordData }) {
  const shown = REPORT_FEEDBACK_FIELDS.filter(field => field.key !== 'report_key' && field.key !== 'view'
    && typeof values[field.key] === 'string' && values[field.key] !== '')
  return (
    <section className="card" aria-label="From the report" data-testid="report-feedback-facts">
      <h3>From the report</h3>
      <dl className="facts">
        {shown.map(field => (
          <div key={field.key}>
            <dt>{field.label}</dt>
            <dd>
              {field.key === 'report' && isLocalPath(values.view)
                ? <a href={values.view} data-testid="report-view-link">{String(values.report)}</a>
                : field.key === 'seen_at' ? time(values.seen_at) : display(values[field.key])}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
