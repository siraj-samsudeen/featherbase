# Merchandise hierarchy

The one way Featherbase shows and picks from the merchandise hierarchy: **division › sub-division ›
category › subcategory**, always in that order, with the same separator (`›`) and the same words
for a missing level ("No division", "No sub-division", "No category").

Import from `@featherbase/shop-floor/hierarchy`. It is a subpath of its own: an app that doesn't
use it neither bundles it nor scans it for styles, so adding to it never moves another app's built
files (`pnpm check:app-digests`). An app that uses it adds one line to its stylesheet:

```css
@source '<path to>/packages/shop-floor/hierarchy';
```

## Hierarchy path

`HierarchyPath` shows one path in full. `HierarchyGroups` shows a list under its path: once above
the list when every item shares it, otherwise one heading per path, so two subcategories with the
same name are told apart by their group. `hierarchyText` gives the same path as plain text.

```tsx
<HierarchyGroups items={subcategories} pathOf={s => s}>
  {group => <ul>{group.map(s => <li key={s.code}>{s.name}</li>)}</ul>}
</HierarchyGroups>
```

## Hierarchy picker

`HierarchyPicker` browses Division → Sub-division → Category, then lists that category's
subcategories as checkboxes (or radio buttons with `multiple={false}`). It opens at `start`, keeps
choices across categories, and reports them through `onChange`; `onNodeChange` reports the
category being looked at, for a filter that takes a whole node. `annotate` adds a line under each
subcategory, and a leaf with `disabled` can't be chosen. It is built from native selects and
inputs, so Tab, the arrow keys and Space work as they do everywhere else.

```tsx
<HierarchyPicker
  label="Subcategories to add"
  levels={levels}                      // every { division, subdivision, category }
  start={{ division: 'Women', subdivision: 'Ethnic Wear' }}
  loadLeaves={node => read('category_subcategories', node)}
  selected={chosen}
  onChange={setChosen}
  annotate={leaf => leaf.where}
/>
```
