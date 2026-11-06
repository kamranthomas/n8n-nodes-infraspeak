# Infraspeak API — reference for building this node

Source: https://developer.infraspeak.com/documentation (guides), https://developer.infraspeak.com/api/openapi.yaml (spec).

## Files
- `openapi-v1-requests.yaml` — **read this first.** The v1 endpoints with parameters and request bodies; response schemas stripped.
- `openapi-v1.yaml` — same endpoints with full response schemas. Large (~23k lines): grep it, don't read it whole.
- `openapi-full.yaml` — the complete spec (6.9 MB, git-ignored). Re-download from the URL above if missing. Grep only.

## v1 scope
- **Failure** (Infraspeak's work orders): Create, Get, Get Many (all / open / closed), Update
  — `/failures`, `/failures/{failure}`, `/failures/open`, `/failures/closed`
- **Client**, **Location**: used only as `listSearch` sources for ID fields on Failure — `GET /clients`, `GET /locations`

## API facts
- Base URL `https://api.infraspeak.com/v3`, JSON over HTTPS.
- Auth: `Authorization: Bearer <token>` (Personal Access Token or JWT).
- Rate limit: 60 requests/minute.
- Responses are JSON:API style: `data[]` of `{ id, type, attributes, relationships }`, plus `included`, `meta`, `links`.
- Pagination is opt-in: without `limit`/`page` a list returns everything. With them, the response has
  `meta.pagination { total, count, per_page (default 200), current_page, total_pages }` and `links { self, first, last, next }`.
- `expanded=<rel1,rel2>` includes related records; `sort` is supported on list endpoints.
- Dates use `YYYY-MM-DD HH:MM:SS`, not ISO 8601. Convert from ISO 8601 input.
- Webhooks exist (for a later Infraspeak Trigger node) but are out of scope for v1.
