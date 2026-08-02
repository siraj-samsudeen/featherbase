// Seed the demo relational dataset through the product's own metadata API:
// Supplier ← Purchase Order ▸ PO Line → Item, Employee ← Attendance/Payroll.
const BASE = 'http://localhost:8000'

const login = await fetch(`${BASE}/api/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ usr: 'Administrator', pwd: 'admin' }),
})
const { token } = await login.json()
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  const j = await res.json()
  if (!res.ok) {
    if (res.status === 409 || /already exists/i.test(j.error?.message ?? '')) {
      console.log(`skip (exists): ${path} ${body.name ?? ''}`)
      return null
    }
    throw new Error(`${path} → ${res.status} ${JSON.stringify(j).slice(0, 300)}`)
  }
  return j
}

// ---- tables ----
await post('/api/doctype', {
  name: 'Supplier', id_pattern: 'prompt', title_column: 'supplier_name',
  columns: [
    { column_name: 'supplier_name', column_type: 'Data', reqd: true, in_list_view: true },
    { column_name: 'city', column_type: 'Data', in_list_view: true },
    { column_name: 'state', column_type: 'Choice', choices: 'Active\nOn Hold', in_list_view: true, default_value: 'Active' },
  ],
})
await post('/api/doctype', {
  name: 'Item', id_pattern: 'prompt', title_column: 'item_name',
  columns: [
    { column_name: 'item_name', column_type: 'Data', reqd: true, in_list_view: true },
    { column_name: 'uom', column_type: 'Data', in_list_view: true },
  ],
})
await post('/api/doctype', {
  name: 'PO Line', kind: 'sub_table',
  columns: [
    { column_name: 'item', column_type: 'Reference', reference_table: 'Item', reqd: true, in_list_view: true },
    { column_name: 'qty', column_type: 'Int', reqd: true, in_list_view: true },
    { column_name: 'rate', column_type: 'Currency', in_list_view: true },
    { column_name: 'amount', column_type: 'Currency', in_list_view: true },
  ],
})
await post('/api/doctype', {
  name: 'Purchase Order', id_pattern: 'PO-.####',
  columns: [
    { column_name: 'supplier', column_type: 'Reference', reference_table: 'Supplier', reqd: true, in_list_view: true },
    { column_name: 'order_date', column_type: 'Date', in_list_view: true },
    { column_name: 'stage', column_type: 'Choice', choices: 'Draft\nSubmitted\nTo Receive', in_list_view: true, default_value: 'Draft' },
    { column_name: 'total', column_type: 'Currency', in_list_view: true },
    { column_name: 'lines', column_type: 'Sub-table', row_table: 'PO Line' },
  ],
})
await post('/api/doctype', {
  name: 'Employee', id_pattern: 'EMP-.###', title_column: 'full_name',
  columns: [
    { column_name: 'full_name', column_type: 'Data', reqd: true, in_list_view: true },
    { column_name: 'dept', column_type: 'Data', in_list_view: true },
    { column_name: 'role', column_type: 'Data', in_list_view: true },
    { column_name: 'reports_to', column_type: 'Reference', reference_table: 'Employee' },
  ],
})
await post('/api/doctype', {
  name: 'Attendance', id_pattern: 'ATT-.####',
  columns: [
    { column_name: 'employee', column_type: 'Reference', reference_table: 'Employee', reqd: true, in_list_view: true },
    { column_name: 'att_date', column_type: 'Date', reqd: true, in_list_view: true },
    { column_name: 'att_status', column_type: 'Choice', choices: 'Present\nAbsent\nHalf Day\nOn Leave', in_list_view: true },
  ],
})
await post('/api/doctype', {
  name: 'Payroll Slip', id_pattern: 'SAL-.####',
  columns: [
    { column_name: 'employee', column_type: 'Reference', reference_table: 'Employee', reqd: true, in_list_view: true },
    { column_name: 'month', column_type: 'Data', in_list_view: true },
    { column_name: 'gross', column_type: 'Currency', in_list_view: true },
    { column_name: 'net', column_type: 'Currency', in_list_view: true },
    { column_name: 'slip_state', column_type: 'Choice', choices: 'Draft\nPaid', in_list_view: true, default_value: 'Draft' },
  ],
})

// ---- rows ----
const save = (doctype, doc) => post('/api/save_doc', { doctype, doc })

for (const [name, supplier_name, city, state] of [
  ['SUP-001', 'Acme Metals', 'Chennai', 'Active'],
  ['SUP-002', 'Zenith Polymers', 'Coimbatore', 'Active'],
  ['SUP-003', 'Kaveri Fasteners', 'Madurai', 'On Hold'],
]) await save('Supplier', { name, supplier_name, city, state })

for (const [name, item_name, uom] of [
  ['ITM-001', 'M8 Hex Bolt', 'Nos'],
  ['ITM-002', 'Steel Sheet 2mm', 'Kg'],
  ['ITM-003', 'PVC Granules', 'Kg'],
  ['ITM-004', 'Bearing 6204', 'Nos'],
]) await save('Item', { name, item_name, uom })

const pos = [
  ['SUP-001', '2026-07-04', 'To Receive', [['ITM-002', 120, 82], ['ITM-001', 500, 4.5]]],
  ['SUP-002', '2026-07-06', 'Submitted', [['ITM-003', 400, 96], ['ITM-001', 200, 4.6]]],
  ['SUP-001', '2026-07-11', 'Draft', [['ITM-004', 60, 145], ['ITM-002', 80, 81]]],
  ['SUP-003', '2026-07-15', 'Submitted', [['ITM-001', 1000, 4.4]]],
  ['SUP-002', '2026-07-21', 'To Receive', [['ITM-003', 250, 97], ['ITM-004', 30, 148]]],
  ['SUP-001', '2026-07-28', 'Draft', [['ITM-002', 200, 82]]],
]
for (const [supplier, order_date, stage, lineDefs] of pos) {
  const lines = lineDefs.map(([item, qty, rate]) => ({ item, qty, rate, amount: Math.round(qty * rate) }))
  const total = lines.reduce((s, l) => s + l.amount, 0)
  await save('Purchase Order', { supplier, order_date, stage, total, lines })
}

const e1 = await save('Employee', { full_name: 'Arun Krishnan', dept: 'Production', role: 'Plant Manager' })
const e2 = await save('Employee', { full_name: 'Priya Raman', dept: 'Production', role: 'Line Supervisor', reports_to: e1?.name })
const e3 = await save('Employee', { full_name: 'Fathima Beevi', dept: 'Accounts', role: 'Payroll Officer', reports_to: e1?.name })

const pattern = ['Present', 'Present', 'Present', 'Present', 'Present', 'Half Day', 'Present', 'Present', 'Absent', 'Present', 'Present', 'On Leave']
const emps = [e1, e2, e3].filter(Boolean)
for (let ei = 0; ei < emps.length; ei++) {
  for (let d = 1; d <= 29; d++) {
    const dt = new Date(2026, 6, d)
    if (dt.getDay() === 0 || dt.getDay() === 6) continue
    await save('Attendance', {
      employee: emps[ei].name,
      att_date: `2026-07-${String(d).padStart(2, '0')}`,
      att_status: pattern[(d + ei * 5) % pattern.length],
    })
  }
}

const payroll = [
  [e1, 65000, 57800], [e2, 38000, 34200], [e3, 42000, 37500],
]
for (const [emp, gross, net] of payroll) {
  if (!emp) continue
  for (const [month, state] of [['May 2026', 'Paid'], ['Jun 2026', 'Paid'], ['Jul 2026', 'Draft']]) {
    await save('Payroll Slip', { employee: emp.name, month, gross, net, slip_state: state })
  }
}

console.log('seeded. employees:', emps.map((e) => e.name).join(', '))
