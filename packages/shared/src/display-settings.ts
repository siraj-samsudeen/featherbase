// The display settings a clean install shows (#380): Jeyarama is an Indian
// business, so rupees with Indian grouping (ADR 750) and DD-Mon-YYYY dates
// (ADR 844). The server's System Settings defaults and the web's fallback while
// /api/settings loads both spread this, so they cannot disagree.
export const DISPLAY_DEFAULTS = {
  app_name: 'Featherbase',
  date_format: 'dd-mon-yyyy',
  currency: 'INR',
  currency_precision: 2,
  float_precision: 2,
}
