import type { MouseEvent, ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { cx, fmtCount, touchRowClasses, type LucideIcon } from '@featherbase/shop-floor'
import { GROUP_TONE, RAIL_ROW, ROW_IDLE, ROW_SELECTED, RailFold, RailMenuItem, RailRule, SIDEBAR_HEADING, useSidebarRail, type GroupTone } from './SidebarRail'
import { useGoTo } from './go-to'
import { railMark } from '../lib/sidebar-rail'
import { setSidebarDrawerOpen } from '../lib/sidebar-collapsed'

// #1385 (slice 4): the one way a sidebar section is drawn, for the Admin's own
// groups (Modules, Data, People and Access, …) and for every app's declared
// sections alike. A section is data: a title, its rows (a label, an address, an
// icon, an optional count) and, for a long list of one kind, the one icon it
// folds into in the rail. Pages never draw these rows themselves.

export interface ShownChild {
  label: string
  address: string
  count?: number
  current?: boolean
}

export interface ShownItem extends ShownChild {
  icon?: LucideIcon
  /** The Admin's modules: the page's own emoji takes the icon's place. */
  glyph?: string
  /** In the rail, the row's initials instead of its icon. A row with neither icon nor glyph shows them too. */
  initials?: boolean
  /** The Admin's own: a status beside the row (Waiting for access). */
  badge?: ReactNode
  /** An app's name for the row (`data-sidebar-item`). */
  id?: string
  testid?: string
  children?: ShownChild[]
}

export interface ShownSection {
  id: string
  title?: string
  /** A long list of one kind: one icon in the rail, whose menu lists the rows. */
  fold?: LucideIcon
  /** The group's hue for its icons (the owner's review, 17-Nov); an app's rows keep the ink's. */
  tone?: GroupTone
  testid?: string
  /** The sidebar's first group: no gap above it. */
  first?: boolean
  items: ShownItem[]
}

/** How the rows open: `router` in the Admin (its router, its active rows); `page` on an app's page, where each
 *  address is the browser's own (a hash or query on the app's page, or a page load), and an Admin address on an
 *  app's own address goes through the sign-in hand-off (useGoTo). */
export type SectionLinks = 'router' | 'page'

export function SidebarSections({ sections, links }: { sections: ShownSection[]; links: SectionLinks }) {
  // A section with no rows is not drawn, heading included.
  return <>{sections.filter((section) => section.items.length > 0).map((section) => <SidebarSection key={section.id} section={section} links={links} />)}</>
}

const ADMIN_PATH = /^\/featherbase\/admin(?:[/?#]|$)/
const PLAIN_CLICK = (e: MouseEvent) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)

function SidebarSection({ section, links }: { section: ShownSection; links: SectionLinks }) {
  const rail = useSidebarRail()
  const go = useGoTo()
  const tone = section.tone ? GROUP_TONE[section.tone] : 'text-ink-muted'
  const testid = section.testid ?? `sidebar-section-${section.id}`
  if (rail && section.fold && section.title) return (
    <RailFold label={section.title} icon={section.fold} testid={testid} tone={section.tone}>
      {(close) => section.items.flatMap((item) => [item, ...(item.children ?? [])]).map((row) => (
        <RailMenuItem key={row.address + row.label} close={close} current={row.current} onSelect={() => go(row.address)}>
          <span className="truncate">{row.label}</span>
          {row.count !== undefined && <span className="text-ink-subtle tabular-nums">{fmtCount(row.count)}</span>}
        </RailMenuItem>
      ))}
    </RailFold>
  )
  return (
    <div className={rail ? 'px-2 py-1' : `px-2 ${section.first ? 'pt-1' : 'pt-3'}`} data-testid={testid} data-sidebar-section={section.id}>
      {section.title && (rail
        ? !section.first && <RailRule heading={section.title} />
        : <h2 className={SIDEBAR_HEADING} data-testid="sidebar-group-heading">{section.title}</h2>)}
      {section.items.map((item) => (
        <div key={item.address + item.label} className="contents">
          <Row item={item} links={links} tone={tone} rail={rail} go={go} />
          {!rail && item.children?.map((child) => (
            <Row key={child.address + child.label} item={child} links={links} tone={tone} rail={false} go={go} nested />
          ))}
        </div>
      ))}
    </div>
  )
}

function Row({ item, links, tone, rail, go, nested = false }: {
  item: ShownItem
  links: SectionLinks
  tone: string
  rail: boolean
  go: (href: string) => void
  nested?: boolean
}) {
  const mark = !item.glyph && (item.initials || !item.icon) ? railMark(item.label) : undefined
  const Icon = item.icon
  const base = rail ? RAIL_ROW : touchRowClasses(`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm${nested ? ' pl-9 text-[13px]' : ''}`)
  const content = (
    <>
      {!nested && (rail
        ? item.glyph
          ? <span aria-hidden className="text-base leading-none">{item.glyph}</span>
          : mark
            ? <span aria-hidden data-testid="rail-mark" className={`grid h-[26px] w-[26px] place-items-center rounded-[7px] bg-current/15 text-xs font-bold leading-none ${tone}`}>{mark}</span>
            : Icon && <Icon aria-hidden size={18} className={`shrink-0 ${tone}`} data-testid="sidebar-item-icon" />
        : item.glyph
          ? <span aria-hidden data-testid="sidebar-item-icon" className={`flex w-5 shrink-0 justify-center text-sm leading-none ${tone}`}>{item.glyph}</span>
          : Icon
            ? <Icon aria-hidden size={14} className={`shrink-0 ${tone}`} data-testid="sidebar-item-icon" />
            : <span aria-hidden data-testid="sidebar-item-icon" className={`grid h-5 w-5 shrink-0 place-items-center rounded-md bg-current/15 text-xs font-bold leading-none ${tone}`}>{mark}</span>)}
      <span className={rail ? 'sr-only' : 'min-w-0 flex-1 truncate'}>{item.label}</span>
      {/* #1248: in the rail a count is a badge on the icon, and a zero one shows none. */}
      {item.count !== undefined && (rail
        ? item.count > 0 && <span data-sidebar-count className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-action px-1 text-xs font-bold leading-none text-action-ink">{fmtCount(item.count)}</span>
        : <span data-sidebar-count className="shrink-0 text-xs tabular-nums text-ink-subtle">{fmtCount(item.count)}</span>)}
      {item.badge && <span data-sidebar-count className={rail ? 'absolute -right-1.5 -top-1.5 [&>*]:px-1 [&>*]:py-0 [&>*]:text-xs' : 'contents'}>{item.badge}</span>}
    </>
  )
  const named = { 'data-testid': item.testid, 'data-sidebar-item': item.id, 'data-rail-mark': mark }
  if (links === 'router') {
    const [path, query = ''] = item.address.split('?')
    return (
      <Link
        to={path as never}
        search={Object.fromEntries(new URLSearchParams(query)) as never}
        {...named}
        // TanStack adds activeProps to className rather than replacing it, so
        // the unselected colours live in inactiveProps: never both at once.
        className={cx(base, item.current && ROW_SELECTED)}
        aria-current={item.current ? 'page' : undefined}
        inactiveProps={{ className: item.current ? '' : ROW_IDLE }}
        activeProps={{ className: ROW_SELECTED, 'aria-current': 'page' }}
      >
        {content}
      </Link>
    )
  }
  return (
    <a
      href={item.address}
      {...named}
      aria-current={item.current ? 'page' : undefined}
      onClick={(e) => {
        setSidebarDrawerOpen(false)
        // An Admin page from an app's page goes through the platform's own way there.
        if (ADMIN_PATH.test(item.address) && PLAIN_CLICK(e)) {
          e.preventDefault()
          go(item.address)
        }
      }}
      className={cx(base, item.current ? ROW_SELECTED : ROW_IDLE)}
    >
      {content}
    </a>
  )
}
