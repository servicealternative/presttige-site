# PRESTTIGE / ULTTRA - MASTER SCOPE

Status: locked architectural decisions recorded on 2026-05-27.

## Hierarchy

The operating hierarchy is:

`CRM` -> `projects` -> `programmes`

- CRM is the master operating layer on `ulttra.net`.
- Presttige is one project inside the CRM.
- Founder is one programme/control set inside Presttige.

## CRM Choice

The CRM platform choice is Directus, self-hosted on AWS.

- Target deployment: ECS Fargate.
- Rationale: Directus provides a mature data studio, permissions model, API layer,
  and admin experience without forcing a full custom CRM build from zero.
- Directus was selected over a throwaway internal admin UI and over building the
  CRM from scratch first.

## Build Approach

Path B is locked: build the CRM first.

- Founder controls will live inside the CRM.
- No interim throwaway admin UI will be built.
- The existing `presttige-founder-admin` Lambda remains the backend for Founder
  invite, revoke, and regenerate actions.
- The CRM provides the admin UI for those controls.

## Auth

Authentication uses the existing Cognito setup.

- User pool: `presttige-internal`
- User pool ID: `us-east-1_s5PvTEeHv`
- Access group: `Admins`
- Auth model: single sign-on through Cognito.

## CRM Domain

The CRM domain is:

`crm.ulttra.net`
