// Starter guides Ask answers how-to questions from. Prototype: written here; the real source is
// each app's own help pages (and MotherDuck's guides for the Dives).
export interface Guide { id: string; title: string; words: string[]; body: string; area?: string }
export const GUIDES: Guide[] = [
  { id: 'gap', title: 'What Gap Means', words: ['gap', 'short', 'behind', 'ahead'], area: 'dash',
    body: 'Gap is sales minus target for the same days. A minus gap means sales are behind target by that amount; a plus gap means ahead. It is worked out per subcategory and added up for the store.' },
  { id: 'achieved', title: 'What Achieved Means', words: ['achieved', 'achievement', 'percent', '%'], area: 'dash',
    body: 'Achieved is sales divided by target, as a percentage. 100% means the target was met exactly. A subcategory with no target shows no percentage, never 0%.' },
  { id: 'month', title: 'This Month And Last Month', words: ['month', 'date', 'today', 'through', 'fresh', 'updated', 'as of'], area: 'dash',
    body: 'This month means the month so far, up to the last day the warehouse has sales for. Last month means the whole of last month. Every answer says the day its figures run through.' },
  { id: 'stores', title: 'Why You See These Stores', words: ['store', 'stores', 'see', 'access', 'missing', 'why', 'reach'], area: 'dash',
    body: 'You see the stores and subcategories your job covers: a Store Manager sees the whole store, a Team Leader their sections. If a store or subcategory is missing, your job assignment does not cover it yet. Press Report An Issue on the report and say what is missing; it goes to the people who look after access.' },
  { id: 'issue', title: 'Report A Problem With A Report', words: ['wrong', 'issue', 'problem', 'mistake', 'incorrect', 'report an issue', 'complain'], area: 'tickets',
    body: 'Open the report and press Report An Issue at the top right. Say what looks wrong; the report, your store and the month are attached for you. It becomes a ticket you can follow in Tickets.' },
  { id: 'ticket', title: 'Raise And Follow A Ticket', words: ['ticket', 'request', 'help', 'support', 'ask for'], area: 'tickets',
    body: 'Open Tickets from the app switcher at the top left and press New Ticket. Your tickets are under Raised By Me, and each one shows its state and the latest update.' },
  { id: 'switch', title: 'Move Between Apps', words: ['app', 'switch', 'open', 'find', 'where', 'menu', 'navigate'],
    body: 'The app switcher is at the top left of every page. It lists the apps you may open, such as Dash for reports, Tickets for requests and Ask for questions.' },
  { id: 'sections', title: 'Your Sections And Your Team', words: ['section', 'sections', 'team', 'leader', 'department', 'staff'], area: 'dash',
    body: 'In Dash, Your Sections lists the sections you look after and who works in each. A Department Manager sets up a department under Your Department. A change you propose waits for approval before it takes effect.' },
  { id: 'records', title: 'Open A Record', words: ['record', 'link', 'person', 'details', 'blue'],
    body: 'Anything shown in blue opens something. A person, store, section or ticket named on a page is a link to its record, unless you may not open it, in which case it is plain text.' },
  { id: 'theme', title: 'Dark Mode And Your Account', words: ['dark', 'theme', 'password', 'account', 'sign out', 'language'],
    body: 'Your account menu is at the top right of every page. It holds the light and dark theme, your sign-in methods and Sign Out.' },
]
