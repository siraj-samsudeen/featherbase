// #1218 (D3, D4, D9, D8): Jeyarama's business roles as first offered, written once into the Tables on
// a System Manager's or Report Access Manager's click and edited there afterwards. Nothing reads this
// list to decide anything: the rows do.
import type { Reach, Reaches } from './business-roles.ts'

type Grant = [app: string, level: string, verb: string, thing: string, reach: Reach]
const TICKETS: Grant = ['Tickets', 'User', 'Raise', 'Tickets', 'Own']
const OWN_TASKS: Grant = ['Tasker', 'User', 'Edit', 'Tasks', 'Own']
const TEAM_TASKS: Grant = ['Tasker', 'Manager', 'Edit', 'Tasks', 'Team']
const REPORTS_IN_AREA: Grant = ['Dash', 'Reader', 'View', 'Reports', 'Area']
const SECTIONS: Grant = ['Dash', 'Manager', 'Edit', 'Sections', 'Area']
const GIVE_TO_TEAM: Grant = ['Dash', 'Manager', 'Give', 'Reports', 'Team']
const EVERY_REPORT: Grant = ['Dash', 'Reader', 'View', 'Reports', 'All']

export interface StartingRole { name: string; description: string; reaches: Reaches; by_hand_only?: boolean; grants: Grant[] }
export const STARTING_ROLES: StartingRole[] = [
  { name: 'Staff', reaches: 'Section', description: 'Works in a section. Tasker and Tickets for their own work; no Dash yet.', grants: [OWN_TASKS, TICKETS] },
  { name: 'Team Leader', reaches: 'Section', description: 'Leads a section.', grants: [REPORTS_IN_AREA, ['Dash', 'Reader', 'Edit', 'Sections', 'Area'], TEAM_TASKS, TICKETS] },
  { name: 'Floor Manager', reaches: 'Floor', description: 'Runs a floor of a store.', grants: [REPORTS_IN_AREA, SECTIONS, TEAM_TASKS, TICKETS] },
  { name: 'Department Manager', reaches: 'Department', description: 'Runs a department of a store.', grants: [REPORTS_IN_AREA, SECTIONS, TEAM_TASKS, TICKETS] },
  { name: 'Store Manager', reaches: 'Store', description: 'Runs a store.', grants: [REPORTS_IN_AREA, SECTIONS, GIVE_TO_TEAM, TEAM_TASKS, TICKETS] },
  { name: 'Cluster Manager', reaches: 'Cluster', description: 'Looks after the stores of a cluster.', grants: [REPORTS_IN_AREA, GIVE_TO_TEAM, TEAM_TASKS, TICKETS] },
  { name: 'Buyer', reaches: 'Merchandise', description: 'Buys subcategories for a region.', grants: [REPORTS_IN_AREA, OWN_TASKS, TICKETS] },
  { name: 'Category Head', reaches: 'Merchandise', description: 'Heads the buyers of a category, subdivision or division.', grants: [REPORTS_IN_AREA, GIVE_TO_TEAM, ['Dash', 'Manager', 'Edit', 'Buyer Sections', 'Area'], TEAM_TASKS, TICKETS] },
  { name: 'Head Office', reaches: 'Whole company', description: 'Works at head office; reaches the whole company.', grants: [EVERY_REPORT, OWN_TASKS, TICKETS] },
  { name: 'Leadership', reaches: 'Whole company', description: 'Directors and the chief operating officer; reaches the whole company.', grants: [EVERY_REPORT, GIVE_TO_TEAM, TEAM_TASKS, TICKETS] },
  { name: 'Master Data Steward', reaches: 'Whole company', description: 'Keeps the master tables right: reads, adds and edits them everywhere, and deletes none.', by_hand_only: true,
    grants: [['Master Data', 'Steward', 'View', 'Master Tables', 'All'], ['Master Data', 'Steward', 'Add', 'Master Tables', 'All'], ['Master Data', 'Steward', 'Edit', 'Master Tables', 'All']] },
  { name: 'Vendor', reaches: 'Given place', description: 'An outside supplier, given by hand: sees only their own supplier\'s articles once the supplier area is set up.', by_hand_only: true, grants: [REPORTS_IN_AREA] },
]

/** Today's ten jobs and the two merchandise responsibilities, each mapped to its business role. */
export const STARTING_TITLES: [title: string, role: string][] = [
  ['Staff', 'Staff'], ['Team Leader', 'Team Leader'], ['Floor Manager', 'Floor Manager'], ['Department Manager', 'Department Manager'],
  ['Store Manager', 'Store Manager'], ['Cluster Manager', 'Cluster Manager'], ['Chief Operating Officer', 'Leadership'], ['Director', 'Leadership'],
  ['Managing Director', 'Leadership'], ['Head office staff', 'Head Office'], ['Buyer', 'Buyer'], ['Category head', 'Category Head'],
]
