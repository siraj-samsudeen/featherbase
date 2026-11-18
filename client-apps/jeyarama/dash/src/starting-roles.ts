// #1218 (D3, D4, D9, D8): Jeyarama's business roles as first offered, written into the Tables only on a System
// Manager's Add The Starting Roles click and edited there afterwards. Nothing reads this list to decide anything:
// the rows do. Owner, 18-Nov-2026 (#1277): managers see their team's tickets; Edit Section names and subcategories;
// Head Office has no Dash by default; Master Data Manager (not Steward). External people (consultants) get no role
// by title: they are given roles by hand.
import type { Reach, Reaches } from './business-roles.ts'

type Grant = [app: string, level: string, verb: string, thing: string, reach: Reach]
const TICKETS: Grant = ['Tickets', 'User', 'Raise', 'Tickets', 'Own']
/** Owner, 18-Nov-2026: every manager sees their team's tickets. */
const TEAM_TICKETS: Grant = ['Tickets', 'Manager', 'View', 'Tickets', 'Team']
const OWN_TASKS: Grant = ['Tasker', 'User', 'Edit', 'Tasks', 'Own']
const TEAM_TASKS: Grant = ['Tasker', 'Manager', 'Edit', 'Tasks', 'Team']
const REPORTS_IN_AREA: Grant = ['Dash', 'Reader', 'View', 'Reports', 'Area']
/** Owner, 18-Nov-2026: a section's name and which subcategories sit under it, within the role's area. */
export const SECTIONS_THING = 'Section names and subcategories'
const SECTIONS: Grant = ['Dash', 'Manager', 'Edit', SECTIONS_THING, 'Area']
/** A head's Buyer Sections: moving subcategories between those they head, for the master data team to decide (#1246). */
const BUYER_SECTIONS: Grant = ['Dash', 'Manager', 'Edit', 'Buyer Sections', 'Area']
const GIVE_TO_TEAM: Grant = ['Dash', 'Manager', 'Give', 'Reports', 'Team']
const EVERY_REPORT: Grant = ['Dash', 'Reader', 'View', 'Reports', 'All']
/** The Master Data app at its manager level: read, add and edit every master table, delete none. */
const MASTER_DATA = (verb: string): Grant => ['Master Data', 'Manager', verb, 'Master Tables', 'All']

/** `dash_reader_grants`: Give Old Grants To Business Roles gives this role each report given to Dash Reader (decision 7). */
export interface StartingRole { name: string; description: string; reaches: Reaches; by_hand_only?: boolean; dash_reader_grants?: true; grants: Grant[] }
export const STARTING_ROLES: StartingRole[] = [
  { name: 'Staff', reaches: 'Section', description: 'Works in a section. Tasker and Tickets for their own work; no Dash yet.', grants: [OWN_TASKS, TICKETS] },
  { name: 'Team Leader', dash_reader_grants: true, reaches: 'Section', description: 'Leads a section.', grants: [REPORTS_IN_AREA, ['Dash', 'Reader', 'Edit', SECTIONS_THING, 'Area'], TEAM_TASKS, TEAM_TICKETS] },
  { name: 'Floor Manager', dash_reader_grants: true, reaches: 'Floor', description: 'Runs a floor of a store.', grants: [REPORTS_IN_AREA, SECTIONS, TEAM_TASKS, TEAM_TICKETS] },
  { name: 'Department Manager', dash_reader_grants: true, reaches: 'Department', description: 'Runs a department of a store.', grants: [REPORTS_IN_AREA, SECTIONS, TEAM_TASKS, TEAM_TICKETS] },
  { name: 'Store Manager', dash_reader_grants: true, reaches: 'Store', description: 'Runs a store.', grants: [REPORTS_IN_AREA, SECTIONS, GIVE_TO_TEAM, TEAM_TASKS, TEAM_TICKETS] },
  { name: 'Cluster Manager', dash_reader_grants: true, reaches: 'Cluster', description: 'Looks after the stores of a cluster.', grants: [REPORTS_IN_AREA, GIVE_TO_TEAM, TEAM_TASKS, TEAM_TICKETS] },
  // Owner, 18-Nov-2026: no HR title maps to it yet; the owner decides which do.
  { name: 'Regional Head', dash_reader_grants: true, reaches: 'Region', description: 'Looks after the stores of a region, read from each site\'s region.', grants: [REPORTS_IN_AREA, GIVE_TO_TEAM, TEAM_TASKS, TEAM_TICKETS] },
  { name: 'Buyer', dash_reader_grants: true, reaches: 'Merchandise', description: 'Buys subcategories for a region.', grants: [REPORTS_IN_AREA, OWN_TASKS, TICKETS] },
  { name: 'Category Head', dash_reader_grants: true, reaches: 'Merchandise', description: 'Heads the buyers of a category, subdivision or division.', grants: [REPORTS_IN_AREA, GIVE_TO_TEAM, BUYER_SECTIONS, TEAM_TASKS, TEAM_TICKETS] },
  // Owner, 18-Nov-2026 (decision 5): a Category Head's permissions over the division their merchandise assignment names, in its region.
  { name: 'Division Head', dash_reader_grants: true, reaches: 'Merchandise', description: 'Heads a division, such as Grocery or Home, in the stores of their region.', grants: [REPORTS_IN_AREA, GIVE_TO_TEAM, BUYER_SECTIONS, TEAM_TASKS, TEAM_TICKETS] },
  // Owner, 18-Nov-2026: visual merchandising, one role per reach; reads and team work only, nothing to give or edit.
  { name: 'Visual Merchandising Manager', reaches: 'Region', description: 'Looks after visual merchandising in the stores of a region, read from each site\'s region.', grants: [REPORTS_IN_AREA, TEAM_TASKS, TEAM_TICKETS] },
  { name: 'Visual Merchandiser', reaches: 'Store', description: 'Does visual merchandising in a store.', grants: [REPORTS_IN_AREA, TEAM_TASKS, TEAM_TICKETS] },
  // Owner, 18-Nov-2026: no reports and no Dash by default; head office staff get reports through a role given by hand or a grant.
  { name: 'Head Office', reaches: 'Whole company', description: 'Works at head office. No Dash by default: reports come from a role given by hand or a report given to them.', grants: [OWN_TASKS, TICKETS] },
  // Owner, 18-Nov-2026: the owner names them by hand; no HR title maps to it (a COO of a region is a Regional Head).
  { name: 'Owner Director', reaches: 'Whole company', description: 'The group\'s owner-directors: the whole company and every report.', by_hand_only: true, grants: [EVERY_REPORT, GIVE_TO_TEAM, TEAM_TASKS, TEAM_TICKETS] },
  { name: 'Master Data Manager', reaches: 'Whole company', description: 'Keeps the master tables right: reads, adds and edits them everywhere, and deletes none.', by_hand_only: true,
    grants: [MASTER_DATA('View'), MASTER_DATA('Add'), MASTER_DATA('Edit')] },
  // Owner, 18-Nov-2026: every store, but only the reports given to them as a person: View Reports at Area, never at All.
  { name: 'Report Analyst', reaches: 'Whole company', description: 'Analyses reports across the company: sees every store, and the reports given to them as a person.', by_hand_only: true,
    grants: [REPORTS_IN_AREA, OWN_TASKS, TICKETS] },
  // Owner, 18-Nov-2026: Supplier (was Vendor), D8's supplier area.
  // No Dash until the supplier area exists: a store's reports show every supplier's articles (Codex adversarial round 5).
  { name: 'Supplier', reaches: 'Given place', description: 'An outside supplier, given by hand. No Dash yet: it will see only its own supplier\'s articles once the supplier area is set up.', by_hand_only: true, grants: [TICKETS] },
  // Owner, 18-Nov-2026: consultants testing the apps, given by hand at the stores they test.
  { name: 'Tester', reaches: 'Given place', description: 'Tests the apps, given by hand at the stores it is given for: reads their reports there.', by_hand_only: true, grants: [REPORTS_IN_AREA, OWN_TASKS, TICKETS] },
]

/** Today's jobs and the two merchandise responsibilities, each mapped to its business role. Director, Managing Director and
 *  Chief Operating Officer map to nothing (owner, 18-Nov-2026): Owner Directors are named by hand. */
export const STARTING_TITLES: [title: string, role: string][] = [
  ['Staff', 'Staff'], ['Team Leader', 'Team Leader'], ['Floor Manager', 'Floor Manager'], ['Department Manager', 'Department Manager'],
  ['Store Manager', 'Store Manager'], ['Cluster Manager', 'Cluster Manager'],
  ['Head office staff', 'Head Office'], ['Buyer', 'Buyer'], ['Category head', 'Category Head'], ['Division head', 'Division Head'],
  // Owner, 18-Nov-2026. Merchandiser, the buying side, is not visual merchandising: it stays as it maps.
  ['Manager - visual merchandising', 'Visual Merchandising Manager'], ['Visual merchandiser', 'Visual Merchandiser'],
]

/**
 * Owner, 18-Nov-2026 (decision 7: start narrow; add on request): the roles a report given to Dash Reader is carried to, by
 * name. The manager roles that open Dash; never visual merchandising, a role given by hand only, or one with no Dash.
 * Starting data, not a column on the role: a role renamed or added later gets no old grant, and anything wider is given by hand.
 */
export const DASH_READER_GRANT_ROLES: readonly string[] = STARTING_ROLES.filter(r => r.dash_reader_grants).map(r => r.name)
