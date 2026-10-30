# JeyaRama client apps

Conventions shared by every JeyaRama app in this folder (`dash/` today). The
instances' settings and setup live in the client's private instance
repository, never here (ADR 0014).

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
