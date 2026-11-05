## Decisions

### Where the staff Table is named

Sign In Method rows already carry kind-specific configuration in `settings` (a provider's wire format), and that field is managed by the instance settings file. The roster goes there as `settings.roster`: Table, the columns it reads and writes, the status that means current, the key of the service's answer, and the identifier systems to record.

Alternatives: a hard-coded `Employee` Table (the platform would name a client's Table, against architecture invariant 5), or an App Setting (the Table is not an app's: on JeyaRama's instance it is created outside any app, and the rule belongs to the method). The rule itself is a new `new_person` value, `create_if_on_roster`, because `new_person` is already where a method says what it does with people it does not know.

### What links the row: the service must name the record

StyleHR takes the employee number and uses the first record carrying it, and some numbers are on two records. A yes for a shared number can therefore belong to somebody else. So `provider_record_key` is required, and a yes that does not carry the row's record number is not a yes. This narrows "binding never depends on the body" in `delegated-login.ts`, which keeps holding for people already linked: their person was found before the service was asked.

Alternative: trust the yes because the number matched one row. Rejected: the roster holds only part of StyleHR, so a collision with someone outside it would be invisible and would give one person another's login.

### What a person is keyed on

The link's permanent subject is the row's record number, and its sign-in name is the row's ID, as an administrator's link is. The service's answer only confirms the record; it never supplies it, so `trustedSubject` stays false for the kind.

### How two sign-ins take turns

The transaction locks the roster row, then checks everything again. A sign-in that loses and finds the link it was about to make signs in as the winner; anything else is refused. The unique index on a method's subject backs this up.

### Test mode makes no one

`DELEGATED_LOGIN_TEST_MODE` skips the service, so it can never count as the positive answer this rule needs. Test mode keeps resolving only people already linked.

### The method ships off, with its address in the file

Pre-deploy applies the settings file in one transaction, and a value read from a variable that is not set refuses the whole file, which would fail the deploy. The service address is public and the same everywhere, so it is in the file (as the Google client id is). `enabled` is false in every environment, because turning it on changes the sign-in page and sends staff passwords through that environment: that is the owner's decision, one line in the file's environment section.

`identifier_system` stays out of the file, since the systems come from a seed pack that not every instance has applied, and an unknown link target refuses the file. The pack sets it on the existing row; until then the rule refuses everyone.
