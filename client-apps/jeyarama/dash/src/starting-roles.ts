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
const GIVE_TO_TEAM: Grant = ['Dash', 'Manager', 'Give', 'Reports', 'Team']
const EVERY_REPORT: Grant = ['Dash', 'Reader', 'View', 'Reports', 'All']
/** The Master Data app at its manager level: read, add and edit every master table, delete none. */
const MASTER_DATA = (verb: string): Grant => ['Master Data', 'Manager', verb, 'Master Tables', 'All']

export interface StartingRole { name: string; description: string; reaches: Reaches; by_hand_only?: boolean; grants: Grant[] }
export const STARTING_ROLES: StartingRole[] = [
  { name: 'Staff', reaches: 'Section', description: 'Works in a section. Tasker and Tickets for their own work; no Dash yet.', grants: [OWN_TASKS, TICKETS] },
  { name: 'Team Leader', reaches: 'Section', description: 'Leads a section.', grants: [REPORTS_IN_AREA, ['Dash', 'Reader', 'Edit', SECTIONS_THING, 'Area'], TEAM_TASKS, TEAM_TICKETS] },
  { name: 'Floor Manager', reaches: 'Floor', description: 'Runs a floor of a store.', grants: [REPORTS_IN_AREA, SECTIONS, TEAM_TASKS, TEAM_TICKETS] },
  { name: 'Department Manager', reaches: 'Department', description: 'Runs a department of a store.', grants: [REPORTS_IN_AREA, SECTIONS, TEAM_TASKS, TEAM_TICKETS] },
  { name: 'Store Manager', reaches: 'Store', description: 'Runs a store.', grants: [REPORTS_IN_AREA, SECTIONS, GIVE_TO_TEAM, TEAM_TASKS, TEAM_TICKETS] },
  { name: 'Cluster Manager', reaches: 'Cluster', description: 'Looks after the stores of a cluster.', grants: [REPORTS_IN_AREA, GIVE_TO_TEAM, TEAM_TASKS, TEAM_TICKETS] },
  // Owner, 18-Nov-2026: no HR title maps to it yet; the owner decides which do.
  { name: 'Regional Head', reaches: 'Region', description: 'Looks after the stores of a region, read from each site\'s region.', grants: [REPORTS_IN_AREA, GIVE_TO_TEAM, TEAM_TASKS, TEAM_TICKETS] },
  { name: 'Buyer', reaches: 'Merchandise', description: 'Buys subcategories for a region.', grants: [REPORTS_IN_AREA, OWN_TASKS, TICKETS] },
  { name: 'Category Head', reaches: 'Merchandise', description: 'Heads the buyers of a category, subdivision or division.', grants: [REPORTS_IN_AREA, GIVE_TO_TEAM, ['Dash', 'Manager', 'Edit', 'Buyer Sections', 'Area'], TEAM_TASKS, TEAM_TICKETS] },
  // Owner, 18-Nov-2026: no reports and no Dash by default; head office staff get reports through a role given by hand or a grant.
  { name: 'Head Office', reaches: 'Whole company', description: 'Works at head office. No Dash by default: reports come from a role given by hand or a report given to them.', grants: [OWN_TASKS, TICKETS] },
  { name: 'Leadership', reaches: 'Whole company', description: 'Directors and the chief operating officer; reaches the whole company.', grants: [EVERY_REPORT, GIVE_TO_TEAM, TEAM_TASKS, TEAM_TICKETS] },
  { name: 'Master Data Manager', reaches: 'Whole company', description: 'Keeps the master tables right: reads, adds and edits them everywhere, and deletes none.', by_hand_only: true,
    grants: [MASTER_DATA('View'), MASTER_DATA('Add'), MASTER_DATA('Edit')] },
  // Owner, 18-Nov-2026: Supplier (was Vendor), D8's supplier area.
  { name: 'Supplier', reaches: 'Given place', description: 'An outside supplier, given by hand: sees only their own supplier\'s articles once the supplier area is set up.', by_hand_only: true, grants: [REPORTS_IN_AREA] },
  // Owner, 18-Nov-2026: consultants testing the apps, given by hand at the stores they test.
  { name: 'Tester', reaches: 'Given place', description: 'Tests the apps, given by hand at the stores it is given for: reads their reports there.', by_hand_only: true, grants: [REPORTS_IN_AREA, OWN_TASKS, TICKETS] },
]

/** Today's ten jobs and the two merchandise responsibilities, each mapped to its business role. */
export const STARTING_TITLES: [title: string, role: string][] = [
  ['Staff', 'Staff'], ['Team Leader', 'Team Leader'], ['Floor Manager', 'Floor Manager'], ['Department Manager', 'Department Manager'],
  ['Store Manager', 'Store Manager'], ['Cluster Manager', 'Cluster Manager'], ['Chief Operating Officer', 'Leadership'], ['Director', 'Leadership'],
  ['Managing Director', 'Leadership'], ['Head office staff', 'Head Office'], ['Buyer', 'Buyer'], ['Category head', 'Category Head'],
]
