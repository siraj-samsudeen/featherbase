// Banyan Retail's work in Tasker and Tickets (#1123): made up, across every state and several people.
// People are named by their demo login key (logins in seed.mts); dates are days from the load day,
// so the demo always has late, due and upcoming work.

/** The day `offset` days from today, as YYYY-MM-DD. */
export function day(offset, today = new Date()) {
  const date = new Date(today)
  date.setDate(date.getDate() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export const TASKER = {
  stores: [
    ['DEMO-STORE-BMG', 'Banyan Mangaluru', 'Store', 'store_manager'], ['DEMO-STORE-BUD', 'Banyan Udupi', 'Store', null],
    ['DEMO-STORE-BMY', 'Banyan Mysuru', 'Store', 'floor_manager'], ['DEMO-STORE-BVJ', 'Banyan Vijayawada', 'Store', null],
    ['DEMO-STORE-BTP', 'Banyan Tirupati', 'Store', null], ['DEMO-STORE-BWH', 'Central Warehouse', 'Warehouse', null],
  ],
  projects: [
    ['DEMO-PROJECT-TIRUPATI', 'Tirupati store opening', 'Everything the new store needs before it opens its doors on 5 December.', 'cluster_manager'],
    ['DEMO-PROJECT-WEDDING', 'Wedding season 2026', 'Silk and bridal ranges, displays and staffing for the November to February wedding season.', 'store_manager'],
    ['DEMO-PROJECT-SANKRANTI', 'Sankranti in Andhra', 'Vijayawada and Tirupati, festival stock and offers for mid-January.', 'cluster_manager'],
    ['DEMO-PROJECT-STOCKCOUNT', 'Year-end stock count', 'Every store and the warehouse count stock on the last Sunday of December.', 'hr'],
    ['DEMO-PROJECT-STOREOPS', 'Store operations', 'Day-to-day jobs in the stores: repairs, supplies, paperwork.', null],
  ],
  // [id, title, project, store, state, assignee, start, due, extra]
  tasks: [
    ['T01', 'Sign the Tirupati fire-safety certificate', 'TIRUPATI', 'BTP', 'Blocked', 'cluster_manager', -10, 4, { urgent: true, explanation: 'Blocked until the fire department visits; booked for Thursday.' }],
    ['T02', 'Hire and train 12 sales staff for Tirupati', 'TIRUPATI', 'BTP', 'In progress', 'hr', -20, 15, { comments: ['Eight offers accepted so far.', 'Training starts on the 25th at Vijayawada.'] }],
    ['T03', 'Install billing counters and the network', 'TIRUPATI', 'BTP', 'Not started', 'it', 3, 18, {}],
    ['T04', 'Plan the opening-day offers', 'TIRUPATI', 'BTP', 'Submitted for verification', 'cluster_manager', -6, 2, { verifier: 'store_manager', evidence_note: 'Offer sheet attached: 10% on silk, free fall stitching on every saree.' }],
    ['T05', 'Receive the first stock transfer from the warehouse', 'TIRUPATI', 'BWH', 'On hold', 'warehouse', -2, 12, { explanation: 'On hold until the store racks are fixed.' }],
    ['T06', 'Build the bridal silk display', 'WEDDING', 'BMG', 'In progress', 'team_leader', -5, 1, { urgent: true, comments: ['Mannequins arrived; backdrop still at the printer.'] }],
    ['T07', 'Order extra Kanchipuram silk for December', 'WEDDING', 'BMG', 'Done', 'team_leader', -25, -12, { evidence_note: 'Order placed with the weavers’ society; delivery by 1 December.' }],
    ['T08', 'Train the silk section on draping', 'WEDDING', 'BMY', 'Not started', 'floor_manager', 2, 9, {}],
    ['T09', 'Book a second fall-stitching tailor', 'WEDDING', 'BMG', 'Cancelled', 'store_manager', -9, -3, { change_reason: 'The existing tailor can take the extra work on weekends' }],
    ['T10', 'Review last year’s wedding-season sales by subcategory', 'WEDDING', null, 'Done', 'cluster_manager', -30, -20, { evidence_note: 'Silk up 14% on last year; bridal flat. Notes shared with store managers.' }],
    ['T11', 'Agree Sankranti offers with the Vijayawada team', 'SANKRANTI', 'BVJ', 'Not started', 'cluster_manager', 10, 30, {}],
    ['T12', 'Order dhotis and veshti sets for Sankranti', 'SANKRANTI', 'BVJ', 'In progress', 'cluster_manager', -3, 20, {}],
    ['T13', 'Publish the stock-count rota', 'STOCKCOUNT', null, 'Not started', 'hr', 15, 35, {}],
    ['T14', 'Clear the damaged-goods shelf before the count', 'STOCKCOUNT', 'BWH', 'In progress', 'warehouse', -4, -1, { comments: ['Two cartons left; supplier pickup moved to tomorrow.'] }],
    ['T15', 'Fix the flickering lights on the second floor', 'STOREOPS', 'BMG', 'Submitted for verification', 'store_manager', -3, 0, { verifier: 'cluster_manager', evidence_note: 'Electrician replaced four tubes and the choke.' }],
    ['T16', 'Restock carry bags at every counter', 'STOREOPS', 'BMY', 'Done', 'floor_manager', -2, -1, {}],
    ['T17', 'Send the monthly attendance to HR', 'STOREOPS', 'BMG', 'Not started', 'team_leader', 0, 3, {}],
    ['T18', 'Renew the Udupi trade licence', 'STOREOPS', 'BUD', 'In progress', 'cluster_manager', -15, -2, { urgent: true, comments: ['Application filed; the office asked for the rent agreement copy.'] }],
  ],
}

/** Ticket types configured in Tickets: states, done states and the fields asked on intake. */
export const TICKET_TYPES = [
  { type_key: 'maintenance', label: 'Store maintenance', states: ['New', 'Assigned', 'Waiting on vendor', 'Fixed'], done: ['Fixed'], visible: 'everyone',
    fields: [['store', 'Store', 'link', '', 'Site', 'name', true], ['area', 'Where in the store', 'text', '', '', '', true],
      ['urgency', 'Urgency', 'choice', 'Low\nMedium\nHigh', '', '', true]] },
  { type_key: 'data_quality', label: 'Data quality', states: ['New', 'Investigating', 'Fixed', 'Won\'t fix'], done: ['Fixed', 'Won\'t fix'], visible: 'everyone',
    fields: [['table_name', 'Table', 'choice', 'Section\nSubcategory\nSection Subcategory\nEmployee\nJob Assignment', '', '', true],
      ['rows', 'Affected rows', 'long text', '', '', '', true], ['how_to_check', 'How to check', 'long text', '', '', '', false]] },
  { type_key: 'it_help', label: 'IT help', states: ['New', 'Assigned', 'Fixed'], done: ['Fixed'], visible: 'private',
    fields: [['device', 'Device', 'choice', 'Billing counter\nPrinter\nLaptop\nPhone\nNetwork', '', '', true]] },
]

// [id, raiser, type, title, original, details, then: [state, assignee, public_update] | null, notes]
export const TICKETS = [
  ['K01', 'store_manager', 'maintenance', 'Lift stuck between first and second floor', 'The customer lift stopped between floors at 11:40. Nobody inside. Lift is switched off and signposted.',
    { store: 'BMG', area: 'Customer lift', urgency: 'High' }, ['Waiting on vendor', 'store_manager', 'The lift company visits tomorrow morning.'], ['Called the lift company; ticket number noted.']],
  ['K02', 'floor_manager', 'maintenance', 'Trial room door lock broken', 'The second trial room on the ground floor does not lock.', { store: 'BMY', area: 'Ground floor trial rooms', urgency: 'Medium' },
    ['Fixed', 'floor_manager', 'Carpenter fitted a new lock.'], []],
  ['K03', 'team_leader', 'maintenance', 'AC dripping on the silk counter', 'Water drips from the AC vent over the silk counter. Sarees moved for now.', { store: 'BMG', area: 'Silk Sarees counter', urgency: 'High' },
    ['Assigned', 'store_manager', null], []],
  ['K04', 'cluster_manager', 'maintenance', 'Signboard light off at night', 'The front signboard does not light up after 7 pm.', { store: 'BVJ', area: 'Front signboard', urgency: 'Low' }, null, []],
  ['K05', 'team_leader', 'data_quality', 'Udupi Home Linen is closed but still listed', 'Home Linen at Udupi closed in September, but the section still shows in the store layout.',
    { table_name: 'Section', rows: 'BUD-FF-Home Linen', how_to_check: 'Open Section and filter Site = Banyan Udupi.' }, ['Investigating', 'hr', 'HR is checking whether to remove it or keep it inactive.'], []],
  ['K06', 'store_manager', 'data_quality', 'Carry bags and gift wrap have no section', 'Non-trade subcategories at Mangaluru sit in no section, so no Team Leader sees them in Dash.',
    { table_name: 'Section Subcategory', rows: 'Carry bags, Gift boxes, Hangers, Saree fall stitching, Alterations, Gift wrap at Banyan Mangaluru', how_to_check: 'Filter Section Subcategory for Store = Banyan Mangaluru and Section empty.' },
    ['Won\'t fix', 'hr', 'Non-trade lines stay out of sections on purpose: the Store Manager sees them.'], []],
  ['K07', 'floor_manager', 'data_quality', 'A leaver still shows as Team Leader', 'Someone who left in June still shows on the Mysuru first floor.', { table_name: 'Job Assignment', rows: 'Mysuru, first floor', how_to_check: 'Job Assignment with no end date for an Employee whose status is Left.' },
    ['Fixed', 'hr', 'Job ended on the leaving date.'], ['Checked Employment: left on 30 June.']],
  ['K08', 'hr', 'data_quality', 'Handbags moved floor at Mangaluru', 'Handbags moved from Accessories to Western Wear on 1 August; please check the history reads right.',
    { table_name: 'Section Subcategory', rows: 'BMG Handbags' }, null, []],
  ['K09', 'store_manager', 'it_help', 'Billing counter 2 printer jams', 'Counter 2 printer jams every few bills since this morning.', { device: 'Printer' }, ['Assigned', 'it', null], []],
  ['K10', 'cluster_manager', 'it_help', 'Cannot sign in on the store laptop', 'The Vijayawada office laptop says the password expired.', { device: 'Laptop' }, ['Fixed', 'it', 'Password reset; signed in.'], []],
  ['K11', 'team_leader', 'generic', 'Need more hangers for the kurti racks', 'We are short of about 200 hangers on the first floor.', {}, null, []],
  ['K12', 'floor_manager', 'report', 'Sales report shows last month only for Kids', 'The Kids figures on the sales page look like last month\'s.', {}, null, []],
]
