// An app with a store picker in the shared bar, for app-navigation's
// scenarios (#1197). Its page (client/page.mjs) links to its report, keeping
// the store the bar set.
export const platformVersion = '2026-10'
export const reads = {
  stores() {
    return [{ value: '9901', label: 'Hill Road' }, { value: '9902', label: 'Lakeside' }]
  },
}
