## Why
The literal packaged upgrade proof exposes a generic form action row wider than 375px. Browser focus scrolling can move the breadcrumb and fields off the left edge. The attachment remove control additionally depends on hover. Neither is application-specific.

## What Changes
- Contain generic forms at narrow widths by wrapping heading/actions and long content, not hiding page overflow.
- Keep attachment identity and remove controls visible for touch and keyboard users.
- Exercise blank, populated, error and lifecycle refusal states at 375px and desktop using real browser bounds and screenshots.

## Capabilities
### Modified Capabilities
- `core-forms`: responsive generic editor and attachment reachability, following the separate characterized baseline.

## Impact
Generic form and attachment presentation, browser tests. No API, migration, identity, permission or Tasker change. The integrator retains ownership of the literal package proof script.
