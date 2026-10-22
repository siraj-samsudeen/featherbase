# Research memo — one person, many identifiers

Written 22-Oct-2026 for the `person-resolution` change. Three sub-agents read
primary sources (vendor docs, RFCs, HL7 pages, the Aadhaar statutes and UIDAI
circulars); their memos are condensed here. The StyleHR profile at the end was
measured read-only on the warehouse mirror with `dbt_dev_service_account`.
Every claim cites a source in the list; **UNCERTAIN** marks what could not be
verified from a primary source.

## 1. How mature systems model it

### Healthcare: HL7 FHIR Patient / Person

- An `Identifier` is a row, not a column: `use` (usual | official | temp |
  secondary | old), `type`, `system` (a URI namespace), `value`, `period`
  (when valid) and `assigner` [F1][F2]. `old` is "no longer valid but may still
  be useful for searching", named for exactly our case: account merges [F2].
- `Patient.link.type`: `replaced-by` (do not use this record; follow the link),
  `replaces` (this is the survivor; the link points at the merged-away record),
  `refer`, `seealso` [F3]. A merged-away record is kept, marked inactive,
  never deleted by default [F4][F5].
- R5 `$merge` takes source and target, supports `preview=true`, writes the two
  links, and says Provenance SHOULD be recorded so that an un-merge is
  possible — but defines no un-merge operation [F5].
- The `Person` resource links one human to several Patient/Practitioner
  records with an `assurance` level 1–4 (probabilistic match … government
  photo ID) [F6][F7]. FHIR calls it an advanced feature many systems skip [F6].

### Master data management (golden record)

- Three-zone matching: above an upper cut-off → automatic link; below a lower
  cut-off → no match; between → clerical (steward) review. No universal
  thresholds [M1]. Informatica MDM routes "definite" matches to automerge and
  "close" matches to a steward's Merge Manager, with a cap on the review
  backlog [M2]. Reltio distinguishes "automatic" rules (exact strong keys) from
  "suspect" rules (fuzzy), and lets a steward mark "Not a Match" so the pair
  stops reappearing [M3][M4].
- Survivorship is stated as ordered rules: trust/source priority, then
  recency, then a deterministic tie-break; manual override is itself recorded
  [M5][M6].
- A cross-reference (XREF) table keeps one row per contributing source record;
  it is what makes unmerge possible, and an unmerged record gets its original
  id back [M7]. IHE PIX keeps "lists of identifiers that are aliases of one
  another" across identifier domains and deliberately defines no matching
  algorithm [M8]. Dynamics 365 Customer Insights keeps `PreviousCustomerId`
  across merges and splits [M9].

### Identity platforms: linking sign-in accounts

- Every platform separates the person from the login and keys the login by
  (provider, provider-subject): Keycloak `FEDERATED_IDENTITY` [K1], Auth0
  `identities[]` with a primary [A1][A2], SCIM `id` vs `externalId` [S1],
  Entra's immutable `sourceAnchor` — for which UPN and mail are deliberately
  not selectable because they change [E1].
- Default is "make the user prove it": Keycloak's first-login flow confirms by
  email or re-authentication; its AutoLink authenticator is documented as
  "dangerous" where users can register themselves [K2]. Auth0: "request
  authentication for both accounts before linking", and "you should not
  automatically link accounts based on the user's emails" [A1][A3]. Okta's
  Automatic account-link policy matches on the IdP username and Okta suggests
  turning it off once existing users have signed in [O1].
- Trusting the IdP's email claim moves the risk to the IdP (Keycloak Trust
  Email, Auth0 `email_verified`) [K3][A3].
- Linking is lossy and unlinking is not undo: Auth0 discards the secondary's
  metadata and recreates it on unlink as a new user with none [A1][A4]; Entra
  overwrites cloud attributes on a soft match and blocks matches onto
  privileged accounts by default [E2]. Okta can exclude admins from auto-link
  and points to the System Log to review link events [O2].

### HR systems: person vs employment

- Workday: a change of worker type during terminate-and-rehire generates a new
  worker record that keeps personal data and drops work data; a Universal ID
  spans worker types; employee-id reuse is a tenant setting [W1][W2][W3].
- SAP SuccessFactors: Person ID is the stable id across employments; User ID
  and Employment ID are regenerated per employment; "rehire with new
  employment" is recommended; the hire duplicate check can match on national
  ID, which then greys out "proceed as new hire" [SF1][SF2].
- Frappe/ERPNext: Employee has an optional link to User, one User per
  Employee enforced in code; status Active/Inactive/Suspended/Left; "rename
  with merge" repoints links and **deletes** the old record — no undo [FR1]
  [FR2][FR3]. Contact holds many emails/phones in child rows with
  `is_primary` [FR4].

### The UX benchmark: Tableau

- Tableau assigns a role, type, default aggregation and default date level to
  every field, auto-detects relationships from keys and matching names, labels
  what it detected, and lets the user override each default with a "revert to
  default" [T1][T2][T3].

## 2. Patterns adopted, and the failure modes they avoid

| Pattern | Avoids | Source |
|---|---|---|
| Identifier = (system, value, use, period, source) row | a code column that can hold only the current value; lost history | F1, F2 |
| Person separate from employment record | agency→company conversion counted as two people | W1, SF1 |
| Merge by link; loser kept inactive with `replaced-by` | Frappe-style delete that cannot be undone | F3, F5, FR3 |
| Move log per merge (XREF) | unmerge that cannot restore the original id | M7 |
| Three zones: auto / review / no; "not a match" sticks | review queue that re-raises the same pair; silent wrong merges | M1, M3, M4 |
| Deterministic strong key first, fuzzy second | over-matching on names | M3, SF2 |
| Never key or link on email | account takeover through a matching address | A3, K2, E1 |
| No automatic link onto privileged accounts | an admin's access granted by a sync | E2, O2 |
| Survivorship as stated rules + recorded override | an arbitrary winner nobody can explain | M5, M6 |
| Show what was detected; let a human override | opaque automation | T1, T3 |

## 3. Aadhaar — what the law allows (not legal advice)

- **Private use.** The Supreme Court (Puttaswamy, Sept 2018) struck the
  contract limb of Section 57; the 2019 Amendment omitted Section 57, added
  voluntary use by informed consent (s.4(3)), an obligation to offer an
  alternative and not deny service for refusing (s.4(6)), and offline
  verification (s.8A) [L1][L2]. An offline-verification entity must not
  "collect, use, or store an Aadhaar number" (s.8A(4)(b)) [L1]. Penalties:
  civil up to ₹1 crore (s.33A); criminal up to 3 years (s.40) [L1].
- **Storage.** The Aadhaar Data Vault circular (now Circular 14/2025) binds
  requesting entities (AUA/KUA licensees): numbers only in a separate vault,
  reference keys in business tables, AES-256, HSM, and "hashing of Aadhaar
  numbers is not allowed to be used as reference keys" [L3][L4]. The Sharing
  of Information Regulations bind *everyone*: no publishing or displaying the
  number, confidentiality of any database holding it, secure transmission, no
  retention longer than necessary [L5]. Masked Aadhaar shows only the last
  four digits [L6].
- **Without storing.** QR, Paperless Offline e-KYC and the Verifiable
  Credential (Dec 2025 amendment, last 4 digits + demographics + photo) verify
  identity with no number stored [L7].
- **DPDP Act 2023.** Aadhaar is personal data; s.7(i) allows processing for
  employment purposes; s.8 requires safeguards and erasure when the purpose is
  served; Rules notified 14-Nov-2025, main rules in force about May 2027
  (**UNCERTAIN**, re-check the Gazette) [L8][L9].
- **Engineering.** The number is 12 digits with a Verhoeff check digit and
  first digit 2–9 [L10][L11]: about 8×10¹⁰ valid values, so a plain SHA-256
  is reversible by enumeration. A keyed hash (HMAC) with the key outside the
  database is not. UIDAI bans hashes only as *reference keys* for requesting
  entities; a keyed fingerprint used solely to detect duplicates is our
  design, not UIDAI guidance — **UNCERTAIN** whether a regulator would call it
  "storing", so it goes to a lawyer (design §D8).
- **Clearly prohibited for us:** showing the full number on any screen,
  copying it into a mirror in clear, keeping it after the purpose ends.
  **Clearly permitted:** last-four display, demographic data without the
  number, processing employee data for employment under consent and notice.

## 4. What Jeyarama's data says (StyleHR production mirror, 22-Oct-2026)

| Measure | Value |
|---|---|
| Employee records | 30,559 |
| Records with a prior code (`existing_emp_code`) | 6,803 |
| Aadhaar rows / valid 12-digit / distinct numbers | 28,788 / 28,770 / 26,349 |
| Aadhaar numbers held by 2+ records | **2,159** (4,580 records; max 17 records for one number) |
| …of which the records differ in worker type | **665** (the agency → company conversion) |
| Phone numbers shared by 2+ records | 2,774 (6,196 records) — a hint, never proof |
| Records with phone / official email / date of birth | 27,814 / 657 / 30,526 |
| Employee codes in the raw feed | mostly bare numbers and letter-prefixed numbers; `RR-` is added downstream in silver; 28 codes collide across firms (silver header) |

Consequences: Aadhaar is the one strong key we have, and it already lives in
StyleHR (and, in clear, in the warehouse's bronze mirror — flagged). Phone is
a weak key. Name + date of birth is a fuzzy key for Phase 3. The StyleHR
surrogate `id` is the only guaranteed-unique record key and should be an
identifier system of its own.

## Sources

**FHIR** — [F1] https://hl7.org/fhir/R4/datatypes.html#Identifier ·
[F2] https://hl7.org/fhir/R4/valueset-identifier-use.html ·
[F3] https://hl7.org/fhir/R4/valueset-link-type.html ·
[F4] https://hl7.org/fhir/R4/patient.html ·
[F5] https://hl7.org/fhir/R5/patient-operation-merge.html ·
[F6] https://hl7.org/fhir/R4/person.html ·
[F7] https://hl7.org/fhir/R4/valueset-identity-assuranceLevel.html

**MDM** — [M1] https://www.census.gov/content/dam/Census/library/working-papers/1999/adrm/rr99-04.pdf ·
[M2] https://docs.informatica.com/master-data-management/multidomain-mdm/10-4/configuration-guide/part-4--configuring-the-data-flow/mdm-hub-processes/consolidate-process/about-the-consolidate-process/consolidating-records-automatically-or-manually.html ·
[M3] https://community.reltio.com/reltio-product-master-data-management/reltio-match-merge ·
[M4] https://docs.reltio.com/en/objectives/resolve-potential-matches/potential-matching-at-a-glance/potential-matching-operation/review-potential-matches-overview ·
[M5] https://docs.informatica.com/master-data-management/multidomain-mdm/10-5/configuration-guide/part-4--configuring-the-data-flow/mdm-hub-processes/about-informatica-mdm-hub-processes/cell-data-survivorship-and-order-of-precedence.html ·
[M6] https://onlinehelp.informatica.com/IICS/prod/mde/en/cg-c360-bvt-records/Establish_the_best_version_of_the_truth.html ·
[M7] https://docs.informatica.com/master-data-management/multidomain-mdm/10-3/data-steward-guide/managing-data/editing-and-adding-records-manually/effects-of-unmerging-a-row.html ·
[M8] https://profiles.ihe.net/ITI/TF/Volume1/ch-5.html ·
[M9] https://learn.microsoft.com/en-us/dynamics365/customer-insights/data-unification

**Identity platforms** — [K1] https://raw.githubusercontent.com/keycloak/keycloak/main/model/jpa/src/main/java/org/keycloak/models/jpa/entities/FederatedIdentityEntity.java ·
[K2] https://raw.githubusercontent.com/keycloak/keycloak/main/docs/documentation/server_admin/topics/identity-broker/first-login-flow.adoc ·
[K3] https://raw.githubusercontent.com/keycloak/keycloak/main/docs/documentation/server_admin/topics/identity-broker/configuration.adoc ·
[A1] https://auth0.com/docs/manage-users/user-accounts/user-account-linking ·
[A2] https://auth0.com/docs/manage-users/user-accounts/user-account-linking/link-user-accounts ·
[A3] https://auth0.com/docs/manage-users/user-accounts/user-profiles/verified-email-usage ·
[A4] https://auth0.com/docs/manage-users/user-accounts/user-account-linking/unlink-user-accounts ·
[O1] https://developer.okta.com/docs/guides/social-login/github/main ·
[O2] https://help.okta.com/en-us/content/topics/security/idp-add-saml.htm ·
[S1] https://datatracker.ietf.org/doc/html/rfc7643 ·
[E1] https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/plan-connect-design-concepts ·
[E2] https://learn.microsoft.com/en-us/entra/identity/hybrid/connect/how-to-connect-install-existing-tenant

**HR systems** — [W1] https://doc.workday.com/admin-guide/en-us/human-capital-management/staffing/hire-and-terminate/hire-and-terminate-concepts/fdv1492795644058.html ·
[W2] https://doc.workday.com/admin-guide/en-us/human-capital-management/worker-information/contact-and-personal-information/ids/mar1444242050198.html ·
[W3] https://doc.workday.com/admin-guide/en-us/human-capital-management/worker-information/former-workers/troubleshooting--employee-id-is-not-reused-for-a-r.html ·
[SF1] https://userapps.support.sap.com/sap/support/knowledge/en/2413277 ·
[SF2] https://learning.sap.com/courses/sap-successfactors-onboarding-administration/describing-the-rehire-process-in-sap-successfactors-onboarding_de1f5514-9da5-462b-961f-84e9caa505b8 ·
[FR1] https://raw.githubusercontent.com/frappe/erpnext/develop/erpnext/setup/doctype/employee/employee.json ·
[FR2] https://raw.githubusercontent.com/frappe/erpnext/develop/erpnext/setup/doctype/employee/employee.py ·
[FR3] https://raw.githubusercontent.com/frappe/frappe/develop/frappe/model/rename_doc.py ·
[FR4] https://raw.githubusercontent.com/frappe/frappe/develop/frappe/contacts/doctype/contact/contact.json

**Tableau** — [T1] https://help.tableau.com/current/pro/desktop/en-us/datafields_typesandroles.htm ·
[T2] https://help.tableau.com/current/pro/desktop/en-us/datasource_relationships_learnmorepage.htm ·
[T3] https://help.tableau.com/current/pro/desktop/en-us/datasource_relationships_perfoptions.htm

**Aadhaar and data protection** — [L1] Aadhaar and Other Laws (Amendment) Act 2019, https://egazette.gov.in/WriteReadData/2019/207897.pdf ·
[L2] Section 57 commentary (secondary), https://vinodkothari.com/2018/10/the-supreme-court-aadhaar-verdict-major-blow-to-fintech-companies/ ·
[L3] UIDAI Circular 14 of 2025, https://www.uidai.gov.in/images/Circular-No.14_of-2025.pdf ·
[L4] UIDAI Aadhaar Data Vault FAQ, https://www.uidai.gov.in/images/FAQs_Aadhaar_Data_Vault_03112025_v10.pdf ·
[L5] Aadhaar (Sharing of Information) Regulations 2016, https://www.uidai.gov.in/images/The_Aadhaar_Sharing_of_information_regulation_2016.pdf ·
[L6] UIDAI FAQ, masked Aadhaar, https://www.uidai.gov.in/283-faqs/aadhaar-online-services/e-aadhaar/1887-what-is-masked-aadhaar.html ·
[L7] Aadhaar (Authentication and Offline Verification) Amendment Regulations 2025, https://backend.uidai.gov.in/get/files/media/document/2026-06/Regulation.pdf ·
[L8] DPDP Act 2023, https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf ·
[L9] PIB on the DPDP Rules, https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf ·
[L10] UIDAI API error handling (Verhoeff; seen via search snippet only), https://mndc.uidai.gov.in/en/916-developer-section/data-and-downloads-section/11351-api-error-handling.html ·
[L11] python-stdnum Aadhaar validator (third party), https://arthurdejong.org/git/python-stdnum/plain/stdnum/in_/aadhaar.py
