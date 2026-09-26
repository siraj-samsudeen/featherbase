export const REPORT_ID = "sales-target-vs-actual";

export const publishedDefinition = Object.freeze({
  reportId: REPORT_ID,
  revision: "dive-9022f10f-v9-fa457921-kattakada",
  sourceKind: "motherduck_dive_bounded_conversion",
  datasets: Object.freeze(["anchor", "stores", "kpis", "subcategory_rows", "hierarchy_options", "price_bands", "items", "day_ledger"]),
});

const key = (store, code) => `${store}\u0000${code}`;
const roundMeasure = (value, field) => Number(value.toFixed(field.includes("Value") ? 2 : 3));
const sum = (rows, field) => roundMeasure(rows.reduce((total, row) => total + Number(row[field] ?? 0), 0), field);
const within = (date, first, anchor, period) => period === "yesterday" ? date === anchor : date >= first && date <= anchor;

function validateSnapshot(snapshot) {
  if (!snapshot || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.anchor) || !Array.isArray(snapshot.daily) || !snapshot.daily.length) {
    throw new Error("Feather Dash candidate has no complete sales dataset");
  }
  for (const name of ["stores", "hierarchy", "items", "priceBands"]) {
    if (!Array.isArray(snapshot[name])) throw new Error(`Feather Dash candidate lacks ${name}`);
  }
  return snapshot;
}

function actualState(rows, field) {
  const observed = rows.some((row) => row[field] != null);
  return observed ? sum(rows.filter((row) => row[field] != null), field) : null;
}

function completeActual(rows, field) {
  return rows.length > 0 && rows.every((row) => row[field] != null) ? sum(rows, field) : null;
}

export function evaluateReport(snapshotInput, request, authorizedPairs) {
  const snapshot = validateSnapshot(snapshotInput);
  const period = request.period;
  if (!["yesterday", "month_to_date", "day_by_day"].includes(period)) throw new Error("Unsupported report period");
  const stores = request.storeCodes;
  if (!Array.isArray(stores) || !stores.length || stores.some((v) => typeof v !== "string")) throw new Error("A store is required");
  const requestedCodes = request.subcategoryCodes ?? [];
  if (!Array.isArray(requestedCodes) || requestedCodes.some((v) => typeof v !== "string")) throw new Error("Invalid subcategory filter");
  // @spec current_exact_pairs_filter_live_and_cached_rows
  const allowed = new Set(authorizedPairs.map(([store, code]) => key(store, code)));
  if (requestedCodes.some((code) => !authorizedPairs.some(([store, allowedCode]) => stores?.includes(store) && allowedCode === code))) {
    throw new Error("Requested subcategory is outside current scope");
  }
  const first = snapshot.anchor.slice(0, 8) + "01";
  const hierarchy = new Map(snapshot.hierarchy.map((row) => [row.code, row]));
  const scoped = snapshot.daily.filter((row) => allowed.has(key(row.storeCode, row.code)) && stores.includes(row.storeCode)
    && (!requestedCodes.length || requestedCodes.includes(row.code)));
  const reportRows = [];
  const leaves = [...new Set(scoped.map((row) => key(row.storeCode, row.code)))];
  for (const leaf of leaves) {
    const [storeCode, code] = leaf.split("\u0000");
    const rows = scoped.filter((row) => row.storeCode === storeCode && row.code === code && within(row.date, first, snapshot.anchor, period === "day_by_day" ? "month_to_date" : period));
    const h = hierarchy.get(code) ?? {};
    reportRows.push({
      storeCode, code, name: h.subcategory ?? code, division: h.division ?? "", subdivision: h.subdivision ?? "", category: h.category ?? "",
      targetValue: sum(rows, "targetValue"), actualValue: actualState(rows, "actualValue"),
      targetQuantity: sum(rows, "targetQuantity"), actualQuantity: actualState(rows, "actualQuantity"),
      actualIncomplete: rows.some((row) => row.actualValue == null || row.actualQuantity == null),
    });
  }
  reportRows.sort((a, b) => (b.actualValue ?? -Infinity) - (a.actualValue ?? -Infinity) || a.code.localeCompare(b.code));
  const totals = {
    targetValue: sum(reportRows, "targetValue"), actualValue: reportRows.some((r) => r.actualValue == null) ? null : sum(reportRows, "actualValue"),
    targetQuantity: sum(reportRows, "targetQuantity"), actualQuantity: reportRows.some((r) => r.actualQuantity == null) ? null : sum(reportRows, "actualQuantity"),
    incomplete: reportRows.some((r) => r.actualIncomplete),
  };
  const days = [...new Set(scoped.filter((row) => row.date >= first && row.date <= snapshot.anchor).map((row) => row.date))].sort().map((date) => {
    const rows = scoped.filter((row) => row.date === date);
    const actualValue = completeActual(rows, "actualValue");
    const actualQuantity = completeActual(rows, "actualQuantity");
    return {
      date,
      targetValue: sum(rows, "targetValue"),
      actualValue,
      targetQuantity: sum(rows, "targetQuantity"),
      actualQuantity,
      actualIncomplete: actualValue == null || actualQuantity == null,
    };
  });
  let cumulativeTarget = 0, cumulativeActual = 0;
  let cumulativeIncomplete = false;
  const ledger = days.map((day) => {
    cumulativeTarget = roundMeasure(cumulativeTarget + day.targetValue, "targetValue");
    cumulativeIncomplete ||= day.actualValue == null;
    if (!cumulativeIncomplete) cumulativeActual = roundMeasure(cumulativeActual + day.actualValue, "actualValue");
    return { ...day, cumulativeTargetValue: cumulativeTarget, cumulativeActualValue: cumulativeIncomplete ? null : cumulativeActual, cumulativeIncomplete };
  });
  const drill = request.drill;
  let drillResult = null;
  if (drill != null) {
    if (!drill || typeof drill.code !== "string" || typeof drill.storeCode !== "string"
        || !stores.includes(drill.storeCode) || !allowed.has(key(drill.storeCode, drill.code))) {
      throw new Error("Requested drill is outside current scope");
    }
    const drillFirst = period === "yesterday" ? snapshot.anchor : first;
    const sourceItems = snapshot.items.filter((item) => item.storeCode === drill.storeCode && item.code === drill.code
      && allowed.has(key(item.storeCode, item.code)) && item.date >= drillFirst && item.date <= snapshot.anchor);
    const itemRows = [...sourceItems.reduce((items, item) => {
      const current = items.get(item.itemCode) ?? { ...item, actualValue: 0, actualQuantity: 0 };
      current.actualValue += Number(item.actualValue);
      current.actualQuantity += Number(item.actualQuantity);
      items.set(item.itemCode, current);
      return items;
    }, new Map()).values()].map((item) => ({
      ...item,
      actualValue: roundMeasure(item.actualValue, "actualValue"),
      actualQuantity: roundMeasure(item.actualQuantity, "actualQuantity"),
    }));
    const h = hierarchy.get(drill.code) ?? {};
    const store = snapshot.stores.find((row) => row.code === drill.storeCode);
    const own = snapshot.priceBands.filter((band) => band.subcategory === h.subcategory && band.storeFormat === store?.format);
    const bands = own.length ? own : snapshot.priceBands.filter((band) => band.subcategory === h.subcategory && band.storeFormat === "__ALL__");
    const enriched = itemRows.map((item) => ({ ...item, realizedPrice: item.actualQuantity ? item.actualValue / item.actualQuantity : null }));
    drillResult = bands.length ? {
      mode: "bands",
      bands: bands.map((band) => ({ ...band, items: enriched.filter((item) => item.realizedPrice >= band.lo && (band.hi == null || item.realizedPrice < band.hi)) })),
    } : { mode: "items", items: enriched };
  }
  const options = reportRows.map(({ code, name, division, subdivision, category }) => ({ code, name, division, subdivision, category }));
  return { anchor: snapshot.anchor, period, rows: reportRows, totals, ledger, options, drill: drillResult };
}

export { validateSnapshot };
