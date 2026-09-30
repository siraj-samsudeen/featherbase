const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be the exact Featherbase user row id`);
  return value;
};

const rows = [
  ["feather_dash.report", { row_id: "sales-target-vs-actual", title: "Sales Target vs Actual", description: "Disposable synthetic data · not live MotherDuck", publication_revision: "fixture-r1", publication_status: "Published demo" }],
  ["feather_dash.store", { row_id: "1515", label: "Kattakada" }],
  ["feather_dash.store", { row_id: "1501", label: "Attakulangara" }],
  ["feather_dash.access", { row_id: required("FEATHER_DASH_TL_A_USER"), employee_id: "DEMO-TL-A", employee_kind: "TL", graph_complete: true, sections: ["Saree A"], pairs: [["1515", "100000001"], ["1515", "100000003"]] }],
  ["feather_dash.access", { row_id: required("FEATHER_DASH_TL_B_USER"), employee_id: "DEMO-TL-B", employee_kind: "TL", graph_complete: true, sections: ["Saree B"], pairs: [["1515", "100000002"]] }],
  ["feather_dash.access", { row_id: required("FEATHER_DASH_DM_USER"), employee_id: "DEMO-DM", employee_kind: "DM", graph_complete: true, sections: ["Saree B", "Men Shirts"], pairs: [["1515", "100000002"], ["1501", "100000004"]] }],
];

process.stdout.write(JSON.stringify(rows.map(([table, row]) => ({ table, row })), null, 2) + "\n");
