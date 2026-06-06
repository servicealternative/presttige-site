# PRESTTIGE / ULTTRA, PERMANENT TOP-LEVEL RULES

These are permanent, frozen rules. They do not change casually. They sit above day-to-day decisions. Claude and Codex must follow them in every step and every order, always.

This file is the top-level permanent rules document. If anything anywhere contradicts this file, this file wins unless Antonio explicitly updates it.

Entity: Ultrattek LLC FZ, Dubai. The retired entity name is out everywhere, no exceptions.

---

## 1. COMPLIANCE

- This is a global project. Follow the highest standard of Dubai/UAE, USA, and EU practices together, always.
- The goal is that the platform is protected in any jurisdiction. If it is sold tomorrow to a company in Europe, it is already aligned with European law.
- This is permanent, like the backups. It applies to every step and every Codex order, no exceptions.
- Infrastructure today is in AWS us-east-1. Data residency and region are decisions to confirm with a lawyer. They do not block universal hygiene work.
- Claude designs aligned with these standards but cannot certify compliance. Formal certification requires a lawyer and an auditor. Claude prepares, professionals certify.

What this means in practice, always built in:

- Encryption at rest and in transit, everywhere.
- No personal data, emails, names, phones, and no tokens in logs, ever.
- Finite log retention, no indefinite retention.
- Durable audit trail, CloudTrail plus application audit records.
- Data subject rights, access, export, correction, and erasure once member login is built.
- Essential and transactional emails are always delivered regardless of marketing consent state.
- Consent captured with proof, what, when, and which version.
- Defined data retention schedules.
- Least privilege as the target state.
- Processor and DPA register.

## 2. BACKUPS

- Before any structural change, back up to all three locations: local disk, Git commit, and S3 bucket `presttige-ulttra-backups-343218208384`, versioned and encrypted.
- Confirm all three before changing anything.

## 3. SCALABILITY

- Every foundational component, auth, DB, CRM, identity, is architected to scale from 1 to 10 million users from the start.
- Built properly once. Never use the fast, shortcut, or throwaway path for foundations.

## 4. ENTITY

- Ultrattek LLC FZ everywhere.
- The retired entity name must not appear in any file, including internal files.
- When converting old documents that reference the retired entity name, strip and replace with Ultrattek LLC FZ.

## 5. TESTING

- Tester is a Presttige tier. It is not an Ulttra user type.
- A Tester lives inside the Presttige members DB as a member like any other, and goes through the same real flows, account creation, password, and member area, so tests are faithful.
- Every Tester record is `synthetic_test=true` and never appears in any statistic, dashboard, count, or analytic, anywhere, including Ulttra CRM.
- A Tester carries `simulated_tier` so it can test any tier, free, club, premier, patron, founder. The real tier is `tester`; `simulated_tier` is what is being tested at the moment, set by Antonio.
- A Tester's permissions are authorized and managed by Antonio from Ulttra. Ulttra is only the management console writing to the Tester's record. The Tester still lives in Presttige.

The three testers, members in the Presttige DB:

- `antoniompereira@me.com`
- `codex.subscriber.tester@presttige.net`
- `analuisasf@gmail.com`, Ana's personal Gmail as tester, separate from her team role `afernandez@presttige.net` in Ulttra

FQ, `fq@freequenza.net`, is the exception: a send and receive test address, always active, never expires, used to send subscriber invites and to test email send and receive. It enters and leaves tests freely. It is not a normal member.

The base refuses any other synthetic or test record with `403`, anti-fake allowlist.

Codex email rule, frozen:

- Codex may not create or use any email beyond its own, `codex.subscriber.tester@presttige.net`.
- When Codex sends a test, it always goes to FQ, exactly as Antonio uses it.
- If Codex needs more, it must ask and Antonio evaluates.
- No self-initiated email creation or use.

Tests never use a real member's data in a way that contacts them. Real production data is never used in tests that touch real people.

`antoniompereira@icloud.com` and `alternativeservice@gmail.com` were deleted and must not return.

## 6. CODEX ORDERS

- Every Codex order ends with `afplay /System/Library/Sounds/Glass.aiff`.
- Hub and spoke: Claude writes English Codex orders, Antonio pastes them, Codex executes, Antonio pastes the report back, Claude validates.
- Claude and Codex never talk directly.
- Codex orders and reports are English only, no exceptions.

## 7. LANGUAGE

- Working language is English by default.
- Master and structural decisions are discussed in Portuguese so Antonio fully understands, then back to English for normal work.
- English coaching: when Antonio writes an error, Claude shows the corrected version briefly with a one-line explanation, then continues. Short and kind, never derails.

## 8. DESIGN

- Generous, consistent margins across the entire platform, site, pages, forms, and mobile.
- Minimum 1cm left, right, and bottom on every page.
- Never cramped. Desktop and mobile.
- Em dashes are always replaced with commas in every document, no exceptions.

## 9. WORKING STYLE

- One topic at a time. No branching threads.
- Claude is direct and short, especially when the fault is its own.
- No deflections. No repeating warnings already acknowledged. Say a thing once.
- "No preference" is never permission to continue generating.
- Documents for humans: concise, one idea per paragraph, no repetition.
- Documents for Codex: can be exhaustive.

---

Last updated: 2026-06-06, added Tester as a Presttige tier and the Codex email rule, sends always to FQ, may not use other emails.

This file does not change casually. Changes are deliberate, made by Antonio's explicit instruction, and noted here.
