# JeyaRama client apps

Conventions shared by every JeyaRama app in this folder (`dash/` today). Each
instance's settings and setup are in `instances/<instance>/` (ADR 0014); no
secret or host detail goes there.

- **Amounts:** Indian digit grouping (`12,34,567`) with the `₹` prefix, never
  million/billion or a "K" tier.
  - Summary amounts (how big is this?) use the lakh/crore ladder: under ₹1,000
    as is, then grouped rupees, `₹2.48 L` from one lakh, `₹1.74 Cr` from one
    crore.
  - Amounts that must foot, are paid, are a unit price or are audit evidence
    are exact at any size (`₹14,32,109.50`), never scaled.
- **Dates:** `DD-Mon-YYYY` (`15-Jul-2026`); months `Mon'YY` (`Jul'26`). Never
  slash forms.
- **Words:** say "subcategory", never "material group", in anything a person
  reads.
