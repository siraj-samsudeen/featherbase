const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be the exact Featherbase user row id`);
  return value;
};

const rows = [
  ["feather_dash.report", { row_id: "sales-target-vs-actual", title: "Sales Target vs Actual", description: "Live MotherDuck · bounded Kattakada Dev preview", publication_revision: "dive-9022f10f-v9-fa457921-kattakada", publication_status: "Published Dev preview" }],
  ["feather_dash.store", { row_id: "1515", label: "Kattakada" }],
  ["feather_dash.access", { row_id: required("FEATHER_DASH_PREVIEW_USER"), employee_id: "DEV-PREVIEW", employee_kind: "TL", graph_complete: true, sections: ["Precomputed Dev preview"], pairs: [["1515", "010502001"], ["1515", "010502003"]] }],
];

process.stdout.write(JSON.stringify(rows.map(([table, row]) => ({ table, row })), null, 2) + "\n");
