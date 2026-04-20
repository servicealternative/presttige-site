# Presttige — Execution Rules (AGENTS.md)

This file defines how all code, design, and communication artifacts must be generated and implemented.

## Source of truth

The file:
**"Presttige — Matriz & Regras"**

is the single source of truth.

All work must comply with it exactly.

---

## Absolute rules

- Do not invent styles
- Do not reinterpret design
- Do not override tokens
- Do not adjust spacing
- Do not change typography
- Do not create alternative layouts
- Do not merge with previous variants
- Do not apply “best practices” that conflict with the document

If something is not explicitly defined in the document:
→ do not guess  
→ ask or flag

If any instruction conflicts with the document:
→ follow the document  
→ report the conflict

---

## Scope of application

These rules apply to:

- transactional emails
- promotional emails
- frontend UI
- signatures
- documents
- any visual or editorial output

---

## Design system enforcement

All color, typography, and layout decisions must follow:

- Section 1 — Design system (tokens)
- Section 2 — Email architecture
- Section 3 — Editorial rules
- Section 4 — Naming conventions

No deviations allowed.

---

## Email-specific rules

- Use only the approved template structure
- Do not modify spacing, typography, or hierarchy
- Do not change greeting style (locked)
- Do not split prose into artificial paragraphs
- Do not fake lists with multiple `<p>` blocks
- Use real `<ul>` or `<ol>` where required

---

## Asset rules

- Use only approved assets
- Do not substitute logos or icons
- Do not inline images as base64
- Use HTTPS URLs only

---

## Implementation behavior

When the user provides a template:

- Treat it as final production material
- Implement it exactly
- Do not reinterpret or redesign
- If exact implementation is not possible:
  - stop
  - report the blocking reason
  - do not improvise

---

## Deployment rules

- Ensure changes affect the live system
- Do not assume local changes are live
- Confirm integration with:
  - Lambda functions
  - SES email flow

---

## Output rules

When completing tasks, report only:

1. Exact files modified
2. What was applied
3. Whether implementation matches the source of truth exactly
4. Any blocking issues (if applicable)

No summaries. No redesign explanations.

---

## Philosophy

- Premium does not mean decorative
- Simplicity is intentional
- Consistency is mandatory
- The system is fixed — execution must follow it
