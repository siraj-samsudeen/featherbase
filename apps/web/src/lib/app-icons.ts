import type { AppTabIcon, SidebarIcon } from 'shared'
import {
  ArrowLeftRight, Building2, CircleAlert, CircleCheck, ClipboardList, Folder, Layers, LayoutGrid, Lightbulb, Link2, Package,
  RefreshCw, Rows3, Settings, Shield, SlidersHorizontal, Store, Tag, TrendingUp, TriangleAlert, Truck, UserRoundCheck, Users, Wrench,
} from 'lucide-react'
import { CalendarDays, ChartColumn, Check, House, Inbox, List, ListChecks, Table, Target, UserRound, type LucideIcon } from '@featherbase/shop-floor'

/** The icon each word of an app's declared icon set draws, the same for its
 *  phone tabs (#380) and its row in the app switcher's menu (#1236). */
export const APP_ICON: Record<AppTabIcon, LucideIcon> = {
  home: House, report: ChartColumn, target: Target, list: List,
  checklist: ListChecks, calendar: CalendarDays, inbox: Inbox, person: UserRound,
}

/** #1385 (slice 4): the icon each word of the sidebar's icon set draws, for an app's declared rows. */
export const SIDEBAR_ICON: Record<SidebarIcon, LucideIcon> = {
  ...APP_ICON,
  people: Users, 'person-check': UserRoundCheck, check: Check, 'check-circle': CircleCheck, alert: CircleAlert,
  warning: TriangleAlert, store: Store, building: Building2, folder: Folder, tag: Tag, layers: Layers, grid: LayoutGrid,
  table: Table, chart: ChartColumn, trend: TrendingUp, rows: Rows3, filter: SlidersHorizontal, shield: Shield,
  swap: ArrowLeftRight, idea: Lightbulb, refresh: RefreshCw, settings: Settings, link: Link2, wrench: Wrench,
  box: Package, truck: Truck, clipboard: ClipboardList,
}
