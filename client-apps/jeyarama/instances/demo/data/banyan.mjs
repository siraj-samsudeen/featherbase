// Banyan Retail (#1123): a made-up textile and apparel group for the public demo instance. Every
// name, code, person and figure is invented; only the shape follows production's layout. The rows
// come from a seeded generator, so every run makes the same group.
//
// Safe by construction: emails are on `banyan.example` (RFC 2606, never delivered), and mobiles
// start with 5, which no Indian mobile number does.

/** A small seeded random generator (mulberry32), so the group is the same every run. */
export function seeded(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: list => list[Math.floor(next() * list.length)] }
}

export const EMAIL_DOMAIN = 'banyan.example'

const STATES = [['Karnataka', '29'], ['Andhra Pradesh', '37']]
const REGIONS = [['Karnataka', 'KA10', 'Made-up region'], ['Andhra', 'AP10', 'Made-up region']]
const CITIES = [['Mangaluru', 'Karnataka', 'Dakshina Kannada'], ['Udupi', 'Karnataka', 'Udupi'], ['Mysuru', 'Karnataka', 'Mysuru'],
  ['Vijayawada', 'Andhra Pradesh', 'NTR'], ['Tirupati', 'Andhra Pradesh', 'Tirupati']]
const CLUSTERS = [['COAST', 'Coast'], ['MYS', 'Mysuru'], ['ANDHRA', 'Andhra']]

/** code, name, status, is_store, opened_on, region, cluster, state, city, postal_code, note, plant, plant type, floors, layout */
const SITES = [
  ['BMG', 'Banyan Mangaluru', 'Active', true, '2014-08-15', 'Karnataka', 'COAST', 'Karnataka', 'Mangaluru', '575001', 'Flagship, four floors', '7101', 'Store', 4, 'large'],
  ['BUD', 'Banyan Udupi', 'Active', true, '2018-04-02', 'Karnataka', 'COAST', 'Karnataka', 'Udupi', '576101', '', '7102', 'Store', 2, 'small'],
  ['BMY', 'Banyan Mysuru', 'Active', true, '2016-10-09', 'Karnataka', 'MYS', 'Karnataka', 'Mysuru', '570001', '', '7103', 'Store', 4, 'large'],
  ['BVJ', 'Banyan Vijayawada', 'Active', true, '2021-01-14', 'Andhra', 'ANDHRA', 'Andhra Pradesh', 'Vijayawada', '520001', '', '7104', 'Store', 4, 'large'],
  ['BTP', 'Banyan Tirupati', 'Opening soon', true, '2026-12-05', 'Andhra', 'ANDHRA', 'Andhra Pradesh', 'Tirupati', '517501', 'Opens in December; no sales yet', '7105', 'Store', 2, 'small'],
  ['BWH', 'Central Warehouse', 'Active', false, '2015-06-01', 'Karnataka', 'MYS', 'Karnataka', 'Mysuru', '570016', '', '7190', 'Warehouse', 1, 'warehouse'],
  ['BHO', 'Head Office', 'Active', false, '2014-01-01', 'Karnataka', 'MYS', 'Karnataka', 'Mysuru', '570020', 'Also runs the web shop', '7199', 'E-commerce', 0, 'office'],
]
const FLOOR_NAMES = ['Ground Floor', 'First Floor', 'Second Floor', 'Third Floor']
const FLOOR_CODES = ['GF', 'FF', 'SF', 'TF']

// The merchandise levels, division > subdivision > category > subcategory. A code is 5, the
// division digit, two digits each for subdivision and category, then three for the subcategory.
const HIERARCHY = [
  ['1', 'Women', [
    ['Sarees', [['Silk sarees', ['Kanchipuram silk sarees', 'Mysore silk sarees', 'Soft silk sarees', 'Banarasi silk sarees', 'Tussar silk sarees']],
      ['Cotton sarees', ['Printed cotton sarees', 'Handloom cotton sarees', 'Kota sarees', 'Linen sarees', 'Udupi cotton sarees']],
      ['Fancy sarees', ['Georgette sarees', 'Chiffon sarees', 'Crepe sarees', 'Designer party sarees', 'Organza sarees']],
      ['Bridal', ['Bridal silk sarees', 'Bridal lehengas', 'Bridal blouses']]]],
    ['Ethnic wear', [['Kurtis', ['Cotton kurtis', 'Rayon kurtis', 'Long kurtis', 'Short kurtis', 'Festive kurtis']],
      ['Salwar sets', ['Readymade salwar sets', 'Anarkali sets', 'Palazzo sets', 'Sharara sets']],
      ['Dress materials', ['Cotton dress materials', 'Silk dress materials', 'Unstitched churidar sets']],
      ['Dupattas and shawls', ['Printed dupattas', 'Silk dupattas', 'Woollen shawls', 'Stoles']],
      ['Blouses', ['Readymade blouses', 'Blouse materials']]]],
    ['Western', [['Tops', ['Casual tops', 'Formal tops', 'Women T-shirts', 'Shirts for women']],
      ['Bottoms', ['Women jeans', 'Leggings', 'Palazzos', 'Skirts', 'Jeggings']],
      ['Dresses', ['Maxi dresses', 'Midi dresses', 'Co-ord sets']]]],
    ['Women innerwear', [['Innerwear', ['Bras', 'Panties', 'Women nightwear', 'Slips', 'Shapewear']]]],
  ]],
  ['2', 'Men', [
    ['Formals', [['Formal wear', ['Formal shirts', 'Formal trousers', 'Blazers', 'Suits', 'Ties']]]],
    ['Casuals', [['Casual wear', ['Casual shirts', 'Men T-shirts', 'Men jeans', 'Chinos', 'Men shorts', 'Men track pants', 'Jackets']]]],
    ['Men ethnic', [['Ethnic wear', ['Dhotis', 'Men kurtas', 'Sherwanis', 'Lungis', 'Veshti sets', 'Nehru jackets']]]],
    ['Men innerwear', [['Innerwear', ['Vests', 'Briefs', 'Trunks', 'Socks', 'Men nightwear']]]],
  ]],
  ['3', 'Kids', [
    ['Girls', [['Girls wear', ['Frocks', 'Girls ethnic sets', 'Girls tops', 'Girls leggings', 'Pattu pavadai', 'Girls party wear']]]],
    ['Boys', [['Boys wear', ['Boys shirts', 'Boys T-shirts', 'Boys jeans', 'Boys ethnic sets', 'Boys shorts']]]],
    ['Infants', [['Infant wear', ['Rompers', 'Infant sets', 'Baby blankets', 'Bibs']]]],
    ['School', [['School wear', ['School uniforms', 'School socks', 'School shoes']]]],
  ]],
  ['4', 'Footwear and accessories', [
    ['Footwear', [['Footwear', ['Men sandals', 'Women sandals', 'Kids footwear', 'Formal shoes', 'Sports shoes', 'Slippers']]]],
    ['Accessories', [['Accessories', ['Handbags', 'Wallets', 'Belts', 'Wrist watches', 'Fashion jewellery', 'Sunglasses', 'Umbrellas']]]],
  ]],
  ['5', 'Home', [
    ['Home linen', [['Linen', ['Bedsheets', 'Pillow covers', 'Bath towels', 'Hand towels', 'Curtains', 'Doormats', 'Blankets', 'Comforters']]]],
  ]],
  ['9', 'Non-trade', [
    ['Store supplies', [['Packing', ['Carry bags', 'Gift boxes', 'Hangers']]]],
    ['Services', [['Alterations', ['Saree fall stitching', 'Alterations', 'Gift wrap']]]],
  ]],
]

/** Which subdivisions a section sells, by store layout: [floor index, section name, subdivisions]. */
const LAYOUTS = {
  large: [
    [0, 'Silk Sarees', ['Sarees:Silk sarees', 'Sarees:Bridal']], [0, 'Cotton Sarees', ['Sarees:Cotton sarees']], [0, 'Fancy Sarees', ['Sarees:Fancy sarees']],
    [0, 'Accessories', ['Accessories']],
    [1, 'Kurtis', ['Ethnic wear:Kurtis']], [1, 'Salwar and Dress Materials', ['Ethnic wear:Salwar sets', 'Ethnic wear:Dress materials', 'Ethnic wear:Dupattas and shawls', 'Ethnic wear:Blouses']],
    [1, 'Western Wear', ['Western']], [1, 'Women Innerwear', ['Women innerwear']],
    [2, 'Mens Formals', ['Formals']], [2, 'Mens Casuals', ['Casuals']], [2, 'Mens Ethnic', ['Men ethnic']], [2, 'Mens Innerwear', ['Men innerwear']],
    [3, 'Girls', ['Girls']], [3, 'Boys', ['Boys']], [3, 'Infants', ['Infants']], [3, 'School Uniforms', ['School']],
    [3, 'Footwear', ['Footwear']], [3, 'Home Linen', ['Home linen']],
  ],
  small: [
    [0, 'Sarees', ['Sarees']], [0, 'Accessories', ['Accessories']], [0, 'Footwear', ['Footwear']],
    [1, 'Women Ethnic', ['Ethnic wear', 'Women innerwear']], [1, 'Western Wear', ['Western']], [1, 'Mens Wear', ['Formals', 'Casuals', 'Men ethnic', 'Men innerwear']],
    [1, 'Kids Wear', ['Girls', 'Boys', 'Infants', 'School']], [1, 'Home Linen', ['Home linen']],
  ],
  warehouse: [[0, 'Inward', []], [0, 'Storage', []], [0, 'Dispatch', []]],
  office: [],
}

const NAMES = {
  karnataka: {
    first: ['Divya', 'Karthik', 'Pooja', 'Prajwal', 'Shwetha', 'Raghavendra', 'Ananya', 'Chethan', 'Deepika', 'Manjunath', 'Sahana', 'Varun',
      'Bhavya', 'Nagaraj', 'Rakshitha', 'Santhosh', 'Megha', 'Harish', 'Kavya', 'Ganesh', 'Spoorthi', 'Abhishek', 'Ashwini', 'Pradeep',
      'Nayana', 'Sudeep', 'Vinutha', 'Rohan', 'Shilpa', 'Kiran', 'Fathima', 'Irfan', 'Sameena', 'Rizwan', 'Ayesha', 'Melwyn', 'Reena', 'Joyce', 'Stany', 'Prema'],
    last: ['Rao', 'Shenoy', 'Hegde', 'Kamath', 'Gowda', 'Shetty', 'Bhat', 'Pai', 'Acharya', 'Poojary', 'Kulal', 'Nayak', 'Prabhu', 'Kini',
      'Rahman', 'Ahmed', 'Banu', 'Pinto', 'Lobo', 'Fernandes', 'Dsouza', 'Salian'],
  },
  andhra: {
    first: ['Suresh', 'Lakshmi', 'Venkatesh', 'Padmavathi', 'Srinivas', 'Sravani', 'Ramesh', 'Haritha', 'Naveen', 'Keerthi', 'Prasad',
      'Swathi', 'Mahesh', 'Bhargavi', 'Ravi Teja', 'Sirisha', 'Anil', 'Divya Sri', 'Chaitanya', 'Mounika', 'Gopi', 'Tejaswini'],
    last: ['Naidu', 'Reddy', 'Chowdary', 'Varma', 'Raju', 'Rao', 'Prasad', 'Sastry', 'Murthy', 'Kumar', 'Yadav'],
  },
}

export const DEPARTMENTS = [['Management', ''], ['Sales', ''], ['Billing', ''], ['Visual Merchandising', ''], ['Warehouse', ''],
  ['HR', ''], ['Accounts', ''], ['IT', '']]
export const DESIGNATIONS = [
  ['Managing Director', 'Management'], ['Director', 'Management'], ['Chief Operating Officer', 'Management'], ['Cluster Manager', 'Sales'],
  ['Store Manager', 'Sales'], ['Floor Manager', 'Sales'], ['Section Supervisor', 'Sales'], ['Senior Sales Associate', 'Sales'],
  ['Sales Associate', 'Sales'], ['Cashier', 'Billing'], ['VM Executive', 'Visual Merchandising'], ['Warehouse In-charge', 'Warehouse'],
  ['Warehouse Assistant', 'Warehouse'], ['HR Manager', 'HR'], ['HR Executive', 'HR'], ['Accountant', 'Accounts'], ['IT Executive', 'IT'],
  ['Store Trainee', 'Sales'],
]

/** Every Table's rows, keyed by Table name, in the Tables' own column names. */
export function banyan(seed = 1123) {
  const r = seeded(seed)
  const out = {
    State: STATES.map(([state, gst_code]) => ({ state, gst_code })),
    'Operating Region': REGIONS.map(([region, sales_org_code_sap, note]) => ({ region, sales_org_code_sap, note })),
    City: CITIES.map(([city, state, district]) => ({ city, state, district })),
    Cluster: CLUSTERS.map(([code, name]) => ({ code, name })),
    Site: [], Plant: [], 'Store Floor': [], Section: [], Subcategory: [], 'Section Subcategory': [],
    Department: DEPARTMENTS.map(([department, note]) => ({ department, note })),
    Designation: [...DESIGNATIONS.map(([designation, department]) => ({ designation, department, active: true })),
      { designation: 'Billing Executive', department: 'Billing', active: false }],
    Employee: [], Employment: [], 'Job Assignment': [],
  }

  // Subcategories, with the subdivision:category each one sits under.
  const subcats = []
  for (const [d, division, subdivisions] of HIERARCHY)
    subdivisions.forEach(([subdivision, categories], si) =>
      categories.forEach(([category, names], ci) => names.forEach((subcategory, ni) => {
        const code = `5${d}${String(si + 1).padStart(2, '0')}${String(ci + 1).padStart(2, '0')}${String(ni + 1).padStart(3, '0')}`
        const subcategory_type = division !== 'Non-trade' ? 'Merchandise' : subdivision === 'Services' ? 'Service' : 'Consumable'
        subcats.push({ row_id: code, subcategory, category, subdivision, division, subcategory_type })
      })))
  out.Subcategory = subcats
  const sells = (keys) => subcats.filter(s => keys.some(k => k === s.subdivision || k === `${s.subdivision}:${s.category}`))

  for (const [code, name, status, is_store, opened_on, operating_region, cluster, state, city, postal_code, note, plant, plant_type, floors, layout] of SITES) {
    out.Site.push({ code, name, status, is_store, opened_on, operating_region, cluster, state, city, postal_code, note })
    out.Plant.push({ plant_code: plant, plant_type, site: code })
    for (let f = 0; f < floors; f++) out['Store Floor'].push({ row_id: `${code}-${FLOOR_CODES[f]}`, name: FLOOR_NAMES[f], site: code })
    for (const [f, section, keys] of LAYOUTS[layout]) {
      const floor = `${code}-${FLOOR_CODES[f]}`
      const row_id = `${floor}-${section}`
      // A realistic wrinkle or two: Udupi's home linen is closed, and Tirupati's sections wait for opening.
      const inactive = code === 'BUD' && section === 'Home Linen'
      out.Section.push({ row_id, name: section, site: code, floor, status: inactive ? 'Inactive' : 'Active' })
      if (inactive) continue
      for (const s of sells(keys)) out['Section Subcategory'].push(placement(code, s.row_id, row_id, '2026-01-01'))
    }
    // Non-trade lines are sold at every store but sit in no section: they reach no Team Leader.
    if (is_store) for (const s of subcats.filter(s => s.division === 'Non-trade')) out['Section Subcategory'].push(placement(code, s.row_id, null, '2026-01-01'))
  }
  // History: Mangaluru moved handbags from Accessories to Western Wear on 1 August.
  const moved = out['Section Subcategory'].find(p => p.store === 'BMG' && p.subcategory === subcats.find(s => s.subcategory === 'Handbags').row_id)
  moved.ends_on = '2026-07-31'
  out['Section Subcategory'].push(placement('BMG', moved.subcategory, 'BMG-FF-Western Wear', '2026-08-01'))

  people(r, out)
  return out
}

function placement(store, subcategory, section, starts_on) {
  return { section_subcategory_id: `${store}-${subcategory}-${starts_on}`, store, section, subcategory, starts_on, ends_on: null, source_key: 'Demo' }
}

/** Employees, their employment and their jobs: a full ladder per store, and the head office. */
function people(r, out) {
  const used = new Set()
  let n = 1000
  const mobileOf = code => `+91 50000 1${code.slice(1).padStart(4, '0')}`
  function person(region, designation, department, site, job, extra = {}) {
    const names = NAMES[region]
    let name
    do name = `${r.pick(names.first)} ${r.pick(names.last)}`; while (used.has(name))
    used.add(name)
    const employee_code = `E${++n}`
    const left = extra.left_on != null
    const local = name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').join('.')
    out.Employee.push({ employee_code, name, person: null, work_email: left ? '' : `${local}@${EMAIL_DOMAIN}`, mobile: mobileOf(employee_code), status: left ? 'Left' : 'Current' })
    const year = r.int(2015, 2025)
    const joined_on = extra.joined_on ?? `${year}-${String(r.int(1, 12)).padStart(2, '0')}-${String(r.int(1, 28)).padStart(2, '0')}`
    out.Employment.push({ employment_id: `EMP-${employee_code}-1`, employee: employee_code, designation, department, site,
      joined_on, left_on: extra.left_on ?? null, status: left ? 'Left' : 'Current' })
    if (job && !left) out['Job Assignment'].push({ assignment_id: `JA-${employee_code}-1`, employee: employee_code, job, site,
      floor: extra.floor ?? null, section: extra.section ?? null, reports_to: extra.reports_to ?? null, acting: extra.acting ?? false,
      starts_on: extra.starts_on ?? '2026-01-01', ends_on: null, source_key: 'Demo' })
    return employee_code
  }

  const md = person('karnataka', 'Managing Director', 'Management', 'BHO', 'Managing Director', { joined_on: '2014-01-01' })
  person('karnataka', 'Director', 'Management', 'BHO', 'Director', { reports_to: md, joined_on: '2014-01-01' })
  const coo = person('karnataka', 'Chief Operating Officer', 'Management', 'BHO', 'Chief Operating Officer', { reports_to: md })
  const cms = {}
  for (const [cluster] of CLUSTERS) {
    const store = SITES.find(s => s[6] === cluster && s[3])[0]
    cms[cluster] = person(cluster === 'ANDHRA' ? 'andhra' : 'karnataka', 'Cluster Manager', 'Sales', store, 'Cluster Manager', { reports_to: coo })
  }
  const hrm = person('karnataka', 'HR Manager', 'HR', 'BHO', 'Head office staff', { reports_to: coo })
  for (const [designation, department] of [['HR Executive', 'HR'], ['HR Executive', 'HR'], ['Accountant', 'Accounts'], ['Accountant', 'Accounts'], ['IT Executive', 'IT'], ['VM Executive', 'Visual Merchandising']])
    person('karnataka', designation, department, 'BHO', 'Head office staff', { reports_to: department === 'HR' ? hrm : coo })
  const whm = person('karnataka', 'Warehouse In-charge', 'Warehouse', 'BWH', 'Head office staff', { reports_to: coo })
  for (let i = 0; i < 3; i++) person('karnataka', 'Warehouse Assistant', 'Warehouse', 'BWH', 'Staff', { reports_to: whm })

  for (const [code, , status, is_store, , , cluster, , , , , , , floors] of SITES) {
    if (!is_store) continue
    const region = cluster === 'ANDHRA' ? 'andhra' : 'karnataka'
    const opening = status === 'Opening soon'
    const sm = person(region, 'Store Manager', 'Sales', code, 'Store Manager', { reports_to: cms[cluster], starts_on: opening ? '2026-10-01' : '2026-01-01' })
    const sections = out.Section.filter(s => s.site === code && s.status === 'Active')
    for (let f = 0; f < floors; f++) {
      const floor = `${code}-${FLOOR_CODES[f]}`
      const onFloor = sections.filter(s => s.floor === floor)
      // Mysuru's first floor has no Floor Manager: a Team Leader acts as one.
      const actingFloor = code === 'BMY' && f === 1
      const fm = actingFloor ? null : person(region, 'Floor Manager', 'Sales', code, 'Floor Manager', { floor, reports_to: sm })
      if (opening) continue
      // One Team Leader for each pair of sections, one or two staff in each section.
      for (let i = 0; i < onFloor.length; i += 2) {
        const pair = onFloor.slice(i, i + 2)
        const tl = person(region, 'Section Supervisor', 'Sales', code, 'Team Leader', { floor, section: pair[0].row_id, reports_to: fm ?? sm })
        if (pair[1]) out['Job Assignment'].push({ assignment_id: `JA-${tl}-2`, employee: tl, job: 'Team Leader', site: code, floor,
          section: pair[1].row_id, reports_to: fm ?? sm, acting: false, starts_on: '2026-01-01', ends_on: null, source_key: 'Demo' })
        if (actingFloor && i === 0) out['Job Assignment'].push({ assignment_id: `JA-${tl}-3`, employee: tl, job: 'Floor Manager', site: code, floor,
          section: null, reports_to: sm, acting: true, starts_on: '2026-09-15', ends_on: null, source_key: 'Demo' })
        for (const section of pair) {
          const staff = r.int(1, 2)
          for (let k = 0; k < staff; k++)
            person(region, r.next() < 0.3 ? 'Senior Sales Associate' : 'Sales Associate', 'Sales', code, 'Staff', { floor, section: section.row_id, reports_to: tl })
        }
      }
    }
    if (!opening) for (let k = 0; k < 2; k++) person(region, 'Cashier', 'Billing', code, 'Staff', { floor: `${code}-GF`, reports_to: sm })
    // A leaver per store, kept for history.
    if (!opening) person(region, ...r.pick([['Sales Associate', 'Sales'], ['Cashier', 'Billing']]), code, 'Staff', { left_on: `2026-0${r.int(3, 9)}-${String(r.int(1, 28)).padStart(2, '0')}` })
  }
}
