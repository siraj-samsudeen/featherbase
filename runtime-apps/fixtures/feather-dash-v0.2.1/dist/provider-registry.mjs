let sourceProvider;

export function registerProvider(provider) {
  for (const method of ["catalog", "read", "refresh", "scheduledRefresh"]) {
    if (typeof provider?.[method] !== "function") throw new TypeError(`Feather Dash provider lacks ${method}()`);
  }
  sourceProvider = provider;
}

export function provider() {
  if (!sourceProvider) throw new Error("Feather Dash source provider is not configured");
  return sourceProvider;
}

export function clearProviderForTest() {
  sourceProvider = undefined;
}
