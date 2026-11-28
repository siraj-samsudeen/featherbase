## Why

A Department Manager whose department set-up wasn't confirmed opened the sales report and was told it "couldn't open". The report wasn't broken: Dash refused it because the reader reached nothing yet. Refusals were neither explained to the reader nor logged (#1423, approved by Siraj on 27-Nov-2026).

## What Changes

- A refused report says why in plain words: nothing set up for the reader yet, the report covers whole stores only, the report isn't set up yet, or the reader doesn't have it. "This report couldn't open" stays for real failures.
- Each refusal is one log line naming the person, the report and the reason.

## Capabilities

### New Capabilities

### Modified Capabilities

- `dash-reports`: a refused report says why; a whole-stores refusal says the report covers whole stores only.

## Impact

Dash 0.13.47 (step `report_refusals_explained`, no Table change).
