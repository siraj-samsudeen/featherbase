## Why

On the relationship map, the words on the lines ("organization_id", "Reported To Id") are cut off and crossed by the lines, and a related collection says only "backlink", not which link joins it. With nothing opened, the space under the map is empty, so the row at the center is the one row whose values the user cannot see there (#794).

## What Changes

- The lines carry no words. Each box says how it is related: a linked row shows its title with "<link> · <Table>" beneath; a related collection shows its Table with "via <link>" beneath, using the link's name in words, never a column's internal name.
- With nothing opened, the row at the center is listed under the map, in the same table an opened collection uses.
- Not here: link boxes showing the linked row's title (#794 point 2), delivered by #783.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `search-and-explore`, in the order a person meets them: how each box on the relationship map says it is related; the center row listed until a collection is opened.

## Impact

- Relationship map (`apps/web/src/pages/RelationMap.tsx`): words move from the lines into the boxes, in both the wide and the narrow layout; the center row is listed when nothing is opened.
- Web test `apps/web/test/relation-map.test.tsx`.
