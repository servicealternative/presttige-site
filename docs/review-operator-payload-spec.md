# Review Operator Payload Spec

## Purpose

This document defines the exact request contract that a human reviewer or operator must send to `review-action`.

It does not change backend logic.
It only documents the accepted payload format for the frozen PRESTTIGE admissions decision flow.

## Target Backend

- `backend/lambdas/review-action/lambda.py`

## Accepted Decisions

Accepted `action` values:
- `approve`
- `reject`
- `hold`
- `standby`

Notes:
- `hold` and `standby` are treated as the same review state
- both persist a decision record
- only `approve` triggers invitation flow

## Required Fields

The request must include:

- `lead_id`
- `action`
- `score_a`
- `score_b`
- `score_c`
- `decision_reason`
- `reviewer_id`

## Field Rules

### `lead_id`
- Type: string
- Required: yes
- Must match an existing lead in DynamoDB

### `action`
- Type: string
- Required: yes
- Allowed values:
  - `approve`
  - `reject`
  - `hold`
  - `standby`

### `score_a`
- Type: integer
- Required: yes
- Allowed range:
  - `0` to `3`

### `score_b`
- Type: integer
- Required: yes
- Allowed range:
  - `0` to `3`

### `score_c`
- Type: integer
- Required: yes
- Allowed range:
  - `0` to `3`

### `decision_reason`
- Type: string
- Required: yes
- Must be present as a single-line reason

### `reviewer_id`
- Type: string
- Required: yes
- Must identify the reviewer/operator making the decision

## Optional Field

### `new_cycle`
- Type: boolean-like string or value
- Required: no
- Used only when `action = approve`
- Purpose:
  - force creation of a new invitation cycle
  - intentionally overwrite `offer_sent_at`

Examples accepted by backend:
- `true`
- `1`
- `yes`
- `y`

If omitted:
- existing invitation cycle is preserved
- `offer_sent_at` is not overwritten unless it does not exist yet

## Validation Expectations

The backend expects:

- all required fields present
- all scores valid integers between `0` and `3`
- `decision_reason` present
- `reviewer_id` present
- `lead_id` must exist
- `action` must be valid

Behavior:
- `approve`
  - persists full review decision
  - generates offer link
  - writes `offer_sent_at`
  - updates DB first
  - sends invitation email after DB write
- `reject`
  - persists full review decision
  - no invitation generated
- `hold` / `standby`
  - persists full review decision
  - no invitation generated

## Example Approve Payload

```json
{
  "lead_id": "fdm_ab12cd34ef",
  "action": "approve",
  "score_a": 3,
  "score_b": 2,
  "score_c": 2,
  "decision_reason": "Strong fit with the room and clear alignment.",
  "reviewer_id": "reviewer_01"
}
```

## Example Reject Payload

```json
{
  "lead_id": "fdm_ab12cd34ef",
  "action": "reject",
  "score_a": 1,
  "score_b": 1,
  "score_c": 0,
  "decision_reason": "Application does not meet the minimum threshold.",
  "reviewer_id": "reviewer_01"
}
```

## Example Hold Payload

```json
{
  "lead_id": "fdm_ab12cd34ef",
  "action": "hold",
  "score_a": 2,
  "score_b": 2,
  "score_c": 1,
  "decision_reason": "Requires manual second review before final decision.",
  "reviewer_id": "reviewer_01"
}
```
