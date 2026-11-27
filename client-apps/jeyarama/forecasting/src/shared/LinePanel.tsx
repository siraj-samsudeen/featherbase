// An opened subcategory or group (TL-24..TL-34): how Feather Forecast got its number and the checks on the
// left; the other models and, for a subcategory, the answer and questions on the right. A page passes what
// goes under the other models (`answer`), so the Store Manager's approvals can sit where the Team Leader's
// answer does.
import type { ReactNode } from 'react'
import { BuildUp, Checks, GroupNote, OtherModels, isGroup, type Item } from './ExplainPanel'
import type { HelpTopic } from './model'
import type { Header } from './review'

export function LinePanel({ item, header, storeStep, aop, onHelp, answer, width }: {
  item: Item; header: Header; storeStep: number; aop: boolean; width?: number
  onHelp: (t: HelpTopic) => void
  /** What the right column shows under the other models; a group shows how it is answered. */
  answer?: ReactNode
}) {
  return (
    <div className="fr-panel" style={width ? { width } : undefined} data-testid="line-panel">
      {isGroup(item) && <GroupNote group={item} />}
      <div className="fr-cols">
        <div className="fr-col"><BuildUp l={item} month={header.month} storeStep={storeStep} onHelp={onHelp} /><Checks l={item} month={header.month} storeStep={storeStep} /></div>
        <div className="fr-col">
          <OtherModels l={item} aop={aop} month={header.month} />
          {isGroup(item) ? <div className="fr-dim" style={{ fontSize: 13, marginTop: 16 }}>Answer each subcategory below; the group total follows.</div> : answer}
        </div>
      </div>
    </div>
  )
}
