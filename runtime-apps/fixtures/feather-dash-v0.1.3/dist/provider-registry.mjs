const PROVIDER = Symbol.for("jeyaramagroup.feather_dash.provider.v1");

export function registerProvider(provider) {
  for (const method of ["catalog", "read", "refresh", "scheduledRefresh"]) {
    if (typeof provider?.[method] !== "function") throw new TypeError(`Feather Dash provider lacks ${method}()`);
  }
  globalThis[PROVIDER] = provider;
}

export function provider() {
  const value = globalThis[PROVIDER];
  if (!value) throw new Error("Feather Dash source provider is not configured");
  return value;
}

export function clearProviderForTest() {
  delete globalThis[PROVIDER];
}
