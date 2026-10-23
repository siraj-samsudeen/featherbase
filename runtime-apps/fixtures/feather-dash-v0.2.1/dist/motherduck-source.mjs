export const publishedSource = Object.freeze({
  diveId: "9022f10f-be83-4fba-a729-5399c18d150e",
  diveVersion: 9,
  contentSha256: "fa457921ce45ccea3b3fbf3f743904c5d8dce233c0f76607d23920bbc9b35b6b",
  storeCode: "1515",
  revision: "dive-9022f10f-v9-fa457921-kattakada",
  resources: Object.freeze([
    Object.freeze({ alias: "marts", url: "md:_share/marts/5ab9ba61-03a0-475c-963d-e723b3152332" }),
    Object.freeze({ alias: "gold", url: "md:_share/gold/88866aaa-eb8e-4fd9-a412-00450c2ee509" }),
  ]),
  bounds: Object.freeze({ daily: 50_000, hierarchy: 5_000, items: 100_000, priceBands: 20_000, serializedBytes: 30_000_000 }),
});

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const monthOf = (date) => date.slice(0, 8);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const pairKey = (storeCode, code) => `${storeCode}\u0000${code}`;

function exactResources(value) {
  if (!Array.isArray(value)) return false;
  const actual = value.map((resource) => ({ alias: resource?.alias, url: resource?.url })).sort((a, b) => a.alias.localeCompare(b.alias));
  const expected = [...publishedSource.resources].sort((a, b) => a.alias.localeCompare(b.alias));
  return JSON.stringify(actual) === JSON.stringify(expected);
}

export function verifyDiveVersion(row) {
  // @spec exact_dive_version_is_the_published_source
  if (Number(row?.version) !== publishedSource.diveVersion || row?.content_sha256 !== publishedSource.contentSha256
      || !exactResources(row?.required_resources)) {
    throw new Error("Feather Dash published Dive version does not match this application revision");
  }
}

function normalizedNumber(value, nullable = false) {
  if (value == null && nullable) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function normalizeSnapshot({ anchor, stores, hierarchy, daily, items, priceBands }) {
  return {
    anchor: String(anchor),
    stores: stores.map((row) => ({ code: String(row.code), name: String(row.name), format: String(row.format) })),
    hierarchy: hierarchy.map((row) => ({
      code: String(row.code), subcategory: String(row.subcategory), division: String(row.division ?? ""),
      subdivision: String(row.subdivision ?? ""), category: String(row.category ?? ""),
    })),
    daily: daily.map((row) => ({
      date: String(row.date), storeCode: String(row.storeCode), code: String(row.code),
      targetValue: normalizedNumber(row.targetValue), actualValue: normalizedNumber(row.actualValue, true),
      targetQuantity: normalizedNumber(row.targetQuantity), actualQuantity: normalizedNumber(row.actualQuantity, true),
    })),
    items: items.map((row) => ({
      date: String(row.date), storeCode: String(row.storeCode), code: String(row.code),
      itemCode: String(row.itemCode), itemName: String(row.itemName ?? row.itemCode),
      actualValue: normalizedNumber(row.actualValue), actualQuantity: normalizedNumber(row.actualQuantity),
    })),
    priceBands: priceBands.map((row) => ({
      subcategory: String(row.subcategory), storeFormat: String(row.storeFormat), ord: normalizedNumber(row.ord),
      label: String(row.label), lo: normalizedNumber(row.lo), hi: normalizedNumber(row.hi, true),
    })),
  };
}

export function validatePublishedSnapshot(snapshot) {
  // @spec source_snapshot_passes_boundary_checks
  if (!snapshot || !isoDate.test(snapshot.anchor) || !Array.isArray(snapshot.daily) || !snapshot.daily.length) {
    throw new Error("Feather Dash source has no usable anchor or daily dataset");
  }
  for (const name of ["stores", "hierarchy", "items", "priceBands"]) {
    if (!Array.isArray(snapshot[name])) throw new Error(`Feather Dash source lacks ${name}`);
  }
  for (const [name, limit] of Object.entries(publishedSource.bounds)) {
    if (name !== "serializedBytes" && snapshot[name].length > limit) throw new Error(`Feather Dash source exceeds ${name} row bound`);
  }
  const store = snapshot.stores.find((row) => row.code === publishedSource.storeCode);
  if (!store || snapshot.stores.length !== 1) throw new Error("Feather Dash source store boundary is invalid");
  const hierarchyCodes = new Set(snapshot.hierarchy.map((row) => row.code));
  if (hierarchyCodes.size !== snapshot.hierarchy.length || snapshot.hierarchy.some((row) => !row.code || !row.subcategory)) {
    throw new Error("Feather Dash source hierarchy is not uniquely keyed");
  }
  const subcategories = new Set(snapshot.hierarchy.map((row) => row.subcategory));
  const dailyPairs = new Set();
  const dailyDates = new Set();
  const dailyByDatePair = new Map();
  for (const row of snapshot.daily) {
    const identity = `${row.date}\u0000${row.storeCode}\u0000${row.code}`;
    if (!isoDate.test(row.date) || monthOf(row.date) !== monthOf(snapshot.anchor) || row.date > snapshot.anchor
        || row.storeCode !== publishedSource.storeCode || !hierarchyCodes.has(row.code)) {
      throw new Error("Feather Dash source contains an out-of-bound or orphan daily row");
    }
    if (dailyDates.has(identity)) throw new Error("Feather Dash source contains a duplicate daily leaf date");
    dailyDates.add(identity);
    dailyPairs.add(pairKey(row.storeCode, row.code));
    dailyByDatePair.set(identity, row);
    for (const field of ["targetValue", "targetQuantity"]) if (!finite(row[field])) throw new Error("Feather Dash source contains a non-finite measure");
    for (const field of ["actualValue", "actualQuantity"]) if (row[field] != null && !finite(row[field])) throw new Error("Feather Dash source contains a non-finite measure");
  }
  const itemTotals = new Map();
  for (const row of snapshot.items) {
    const identity = `${row.date}\u0000${row.storeCode}\u0000${row.code}`;
    if (!isoDate.test(row.date) || monthOf(row.date) !== monthOf(snapshot.anchor) || row.date > snapshot.anchor
        || !dailyPairs.has(pairKey(row.storeCode, row.code)) || !dailyByDatePair.has(identity)
        || !finite(row.actualValue) || !finite(row.actualQuantity)) {
      throw new Error("Feather Dash source contains an out-of-bound, orphan, or non-finite item row");
    }
    const totals = itemTotals.get(identity) ?? { value: 0, quantity: 0 };
    totals.value += row.actualValue;
    totals.quantity += row.actualQuantity;
    itemTotals.set(identity, totals);
  }
  for (const [identity, row] of dailyByDatePair) {
    const totals = itemTotals.get(identity) ?? { value: 0, quantity: 0 };
    if (row.actualValue == null || row.actualQuantity == null) {
      if (itemTotals.has(identity)) throw new Error("Feather Dash item actual exists for a missing daily actual");
    } else if (Math.abs(totals.value - row.actualValue) > 0.011 || Math.abs(totals.quantity - row.actualQuantity) > 0.0011) {
      throw new Error("Feather Dash item actual does not reconcile to its daily leaf");
    }
  }
  for (const row of snapshot.priceBands) {
    if (!subcategories.has(row.subcategory) || !finite(row.ord) || !finite(row.lo) || (row.hi != null && !finite(row.hi))) {
      throw new Error("Feather Dash source contains an orphan or non-finite price band");
    }
  }
  const size = Buffer.byteLength(JSON.stringify(snapshot));
  if (size > publishedSource.bounds.serializedBytes) throw new Error("Feather Dash source exceeds serialized-size bound");
  return snapshot;
}

const SQL = Object.freeze({
  version: `select version, required_resources, sha256(content) as content_sha256
    from MD_GET_DIVE_VERSION(version := $version::UINTEGER, id := $diveId::UUID)`,
  anchor: `select strftime(max(actuals_as_of_date), '%Y-%m-%d') as anchor
    from "marts"."sales"."target_vs_actual_daily"`,
  stores: `select s.store_code as code, coalesce(s.store_name, s.store_code) as name,
      coalesce(s.store_format, '__ALL__') as format
    from "gold"."masters"."store" s where s.store_code = $storeCode`,
  hierarchy: `select distinct h.material_group_code as code, h.subcategory, h.division, h.subdivision, h.category
    from "marts"."sales"."target_vs_actual_daily" t
    join "gold"."masters"."merchandise_hierarchy" h on h.material_group_code = t.hierarchy_code
    where t.plant_code = $storeCode and t.hierarchy_level = 'material_group' and h.subcategory is not null
      and t.calendar_year = year($anchor::DATE) and t.calendar_month = month($anchor::DATE)`,
  daily: `select strftime(t.business_date, '%Y-%m-%d') as date, t.plant_code as "storeCode",
      t.hierarchy_code as code, cast(t.target_daily_before_tax as double) as "targetValue",
      cast(t.actual_before_tax as double) as "actualValue", cast(t.target_quantity as double) as "targetQuantity",
      cast(t.actual_quantity as double) as "actualQuantity"
    from "marts"."sales"."target_vs_actual_daily" t
    join "gold"."masters"."merchandise_hierarchy" h on h.material_group_code = t.hierarchy_code
    where t.plant_code = $storeCode and t.hierarchy_level = 'material_group' and h.subcategory is not null
      and t.calendar_year = year($anchor::DATE) and t.calendar_month = month($anchor::DATE)
      and t.business_date <= $anchor::DATE order by t.business_date, t.hierarchy_code`,
  items: `with valid_codes as (
      select distinct t.hierarchy_code as code
      from "marts"."sales"."target_vs_actual_daily" t
      join "gold"."masters"."merchandise_hierarchy" h on h.material_group_code = t.hierarchy_code
      where t.plant_code = $storeCode and t.hierarchy_level = 'material_group' and h.subcategory is not null
        and t.calendar_year = year($anchor::DATE) and t.calendar_month = month($anchor::DATE))
    select strftime(d.business_date, '%Y-%m-%d') as date, d.store_code as "storeCode", i.material_group as code,
      d.item_code_sap as "itemCode", any_value(i.item_name) as "itemName",
      cast(sum(d.sales_before_tax_net) as double) as "actualValue", cast(sum(d.qty_net) as double) as "actualQuantity"
    from "gold"."sales"."sales_item_daily" d
    join "gold"."masters"."item" i on i.item_code_sap = d.item_code_sap
    join valid_codes v on v.code = i.material_group
    where d.store_code = $storeCode
      and d.business_date between date_trunc('month', $anchor::DATE) and $anchor::DATE
    group by 1, 2, 3, 4 order by 1, 3, 4`,
  priceBands: `with represented as (
      select distinct h.subcategory
      from "marts"."sales"."target_vs_actual_daily" t
      join "gold"."masters"."merchandise_hierarchy" h on h.material_group_code = t.hierarchy_code
      where t.plant_code = $storeCode and t.hierarchy_level = 'material_group' and h.subcategory is not null
        and t.calendar_year = year($anchor::DATE) and t.calendar_month = month($anchor::DATE))
    select b.cell_key as subcategory, b.store_format as "storeFormat", b.band_ord as ord,
      b.band_label as label, b.band_lo as lo, b.band_hi as hi
    from "gold"."masters"."price_band_edge" b join represented r on r.subcategory = b.cell_key
    join "gold"."masters"."store" s on s.store_code = $storeCode
    where b.grain = 'subcategory' and b.store_format in (s.store_format, '__ALL__')
    order by 1, 2, 3`,
});

export async function loadPublishedSnapshot(query) {
  const versionRows = await query("version", SQL.version, { version: publishedSource.diveVersion, diveId: publishedSource.diveId });
  if (versionRows.length !== 1) throw new Error("Feather Dash published Dive version is unavailable");
  verifyDiveVersion(versionRows[0]);
  const anchorRows = await query("anchor", SQL.anchor, {});
  const anchor = anchorRows[0]?.anchor;
  if (!isoDate.test(String(anchor ?? ""))) throw new Error("Feather Dash source has no usable anchor");
  const parameters = { storeCode: publishedSource.storeCode, anchor: String(anchor) };
  const stores = await query("stores", SQL.stores, { storeCode: publishedSource.storeCode });
  const hierarchy = await query("hierarchy", SQL.hierarchy, parameters);
  const daily = await query("daily", SQL.daily, parameters);
  const items = await query("items", SQL.items, parameters);
  const priceBands = await query("priceBands", SQL.priceBands, parameters);
  return validatePublishedSnapshot(normalizeSnapshot({ anchor, stores, hierarchy, daily, items, priceBands }));
}
