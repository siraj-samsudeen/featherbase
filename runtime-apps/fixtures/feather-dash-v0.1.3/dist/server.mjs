import { provider } from "./provider-registry.mjs";

export const apiVersion = 1;

function rejectScope(row, reject) {
  const pairs = row?.pairs;
  const sections = row?.sections;
  if (typeof row?.employee_id !== "string" || !row.employee_id || !["TL", "DM"].includes(row.employee_kind)
      || !Array.isArray(sections) || !sections.length || !Array.isArray(pairs) || !pairs.length
      || pairs.some((pair) => !Array.isArray(pair) || pair.length !== 2 || pair.some((value) => typeof value !== "string" || !value))
      || typeof row.graph_complete !== "boolean" || (row.employee_kind === "DM" && !row.graph_complete)) {
    reject("Feather Dash access is not configured");
  }
  return {
    employeeId: row.employee_id,
    employeeKind: row.employee_kind,
    sections: [...sections].sort(),
    pairs: [...new Map(pairs.map((pair) => [JSON.stringify(pair), pair])).values()].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])),
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((name) => [name, canonical(value[name])]));
  return value;
}
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export const scopeResolvers = {
  async employee_scope({ user, requestedStoreCodes, facts, reject }) {
    const scope = rejectScope(await facts.get("feather_dash.access", user), reject);
    const availableStores = [...new Set(scope.pairs.map(([store]) => store))].sort();
    const requested = requestedStoreCodes ?? availableStores;
    if (!Array.isArray(requested) || !requested.length || requested.some((store) => !availableStores.includes(store))) reject("Feather Dash store scope refused");
    return { storeCodes: [...requested].sort(), productScope: scope };
  },
};

export const authorizers = {
  async employee_scope({ authorization, facts, reject }) {
    const current = rejectScope(await facts.get("feather_dash.access", authorization.user), reject);
    if (!equal(current, authorization.productScope)) reject("Feather Dash scope changed");
    return true;
  },
};

function exactPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid Feather Dash request");
  const allowed = new Set(["reportId", "period", "storeCodes", "subcategoryCodes", "drill"]);
  if (Object.keys(payload).some((name) => !allowed.has(name)) || payload.reportId !== "sales-target-vs-actual") throw new Error("Invalid Feather Dash request");
  return payload;
}

export const reads = {
  async catalog() {
    return provider().catalog();
  },
  async sales_target({ payload, authorization, reject }) {
    let request;
    try { request = exactPayload(payload); } catch { reject("Invalid Feather Dash request"); }
    const scope = authorization.productScope;
    if (!scope?.pairs?.length) reject("Feather Dash access is not configured");
    try {
      return await provider().read(request, scope.pairs);
    } catch (error) {
      if (/outside current scope|Invalid|Unsupported|store is required/.test(String(error?.message))) reject("Feather Dash request refused");
      throw error;
    }
  },
};

export { registerProvider, clearProviderForTest } from "./provider-registry.mjs";
