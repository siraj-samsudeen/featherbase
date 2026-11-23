import type { AppTabIcon } from 'shared'
import { CalendarDays, ChartColumn, House, Inbox, List, ListChecks, MessageCircleQuestion, Target, UserRound, type LucideIcon } from '@featherbase/shop-floor'

/** The icon each word of an app's declared icon set draws, the same for its
 *  phone tabs (#380) and its row in the app switcher's menu (#1236). */
export const APP_ICON: Record<AppTabIcon, LucideIcon> = {
  home: House, report: ChartColumn, target: Target, list: List,
  checklist: ListChecks, calendar: CalendarDays, inbox: Inbox, person: UserRound,
  message_question: MessageCircleQuestion,
}
