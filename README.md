# n8n-nodes-infraspeak

This is an n8n community node. It lets you use [Infraspeak](https://infraspeak.com) in your n8n workflows.

Infraspeak is a maintenance management platform (CMMS). This node covers corrective maintenance (**failures**, Infraspeak's work orders), preventive maintenance (**works** and **scheduled works**), and the records around them: clients, locations, assets, problems, categories, suppliers, operators, cost centers, other costs, contacts, requests, files, warehouses, stock and materials, and sales (quotes, buy and sell orders).

> **Beta.** This node is built from Infraspeak's OpenAPI spec and tested against it, but it hasn't been verified against the live Infraspeak API yet. Some filters, date formats or required fields may not behave as expected. Please [open an issue](https://github.com/kamranthomas/n8n-nodes-infraspeak/issues) if something doesn't work.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Trigger](#trigger)
[Usage](#usage)
[Resources](#resources)
[Development](#development)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

While the node is in beta, install it by version: enter `n8n-nodes-infraspeak@beta` (or `n8n-nodes-infraspeak@0.1.0-beta.0`) as the package name.

## Operations

**Buy Order**: Create, Get, Get Many, Update, Delete, Get Lines, Add Line, Update Line, Delete Line

**Category**: Create, Get, Get Many (top-level folders), Get Many (All Levels), Get Children, Update, Delete

**Client**: Create, Get, Get Many, Update, Delete, Associate Contacts

**Contact**: Get Many

**Cost Center**: Create, Get, Get Many, Update, Delete

**Element (Asset)**: Create, Get, Get Many, Update, Delete, Archive, Unarchive

**Failure**

- **Create**: create a failure for a client and location, with a problem type and priority
- **Get**: get a failure by numeric ID or UUID
- **Get Many**: list all, open, or closed failures. You can filter by status, location, problem type, and date ranges (reported, completed, approved, status changed). Return All pages through the API 200 records at a time.
- **Update**: update a failure's fields, such as priority, description, location, and closing note

**File**: Get Many (the files attached to a record)

**Location**: Create, Get, Get Many, Get Many Buildings, Get Children, Update, Update Many, Delete, Duplicate Building. Create and Update ask for a **Type** (building, location folder or location) and show the fields for that type.

**Material Type**: Create, Update, Delete, Get Ancestors

**Material Type Folder**: Create, Get, Get Many, Get Many Root Folders, Get Children, Get Tree, Get Ancestors, Get Material Types (All Levels), Update, Delete

**Operator**: Create, Get, Get Many

**Other Cost**: Create, Get, Get Many, Update, Delete

**Problem**: Get Many Areas, Get Area, Get Many Types

**Quote**: Create, Get, Get Many, Get Lines, Add Line

**Request**: Get

**Scheduled Work**: Get, Get Many, Update

**Sell Order**: Create, Get, Get Many, Update, Delete, Get Lines, Add Line, Update Line, Delete Line

**Stock Material**: Create, Get, Get Many, Update, Delete, Get Registry, Add Stock Transactions

**Stock Status**: Get Many, Update, Delete

**Stock Transaction**: Get Many, Get Many Batches, Transfer, Transfer All

**Supplier**: Create, Get, Get Many, Update, Delete

**Warehouse**: Create, Get, Get Many, Update, Delete, Get Registry, Add Stock Transaction, Check Associations, Remove Operator

**Work** (planned jobs): Create, Get, Get Many, Update

Client, Location, Problem Area, Problem Type, Supplier, Operator, Cost Center, Category and Warehouse fields are searchable dropdowns, or you can enter an ID directly. The Location list only shows real locations, because failures and assets can't be attached to buildings or folders. Problem types only exist inside a problem area, so to pick a Problem Type from the list, choose a Problem Area first. The Problem Area field only narrows the list and isn't sent to Infraspeak.

Delete returns `{ "deleted": true }`; Archive and Unarchive return `{ "success": true }`.

Not covered: the endpoints the API marks deprecated, and the material export (described as an xlsx download, which this node can't verify or handle yet). Use the HTTP Request node with the Infraspeak API credential for anything missing.

Nested structures such as a planned job's recurrence or SLA rules are **JSON** fields: enter the structure the [Infraspeak API reference](https://developer.infraspeak.com) documents for that field. Filters that take several values (for example *Code (Any Of)*) take comma-separated text.

## Credentials

The node authenticates with a bearer token.

1. In Infraspeak, create a Personal Access Token (see [Using the token](https://developer.infraspeak.com/documentation/authentication/using-the-token)).
2. In n8n, create an **Infraspeak API** credential and paste the token into **Access Token**.

Leave **Base URL** at its default (`https://api.infraspeak.com/v3`) unless you're pointing at a sandbox or the local mock described under Development.

The credential test calls `GET /locations?limit=1`.

## Trigger

**Infraspeak Trigger** starts a workflow when Infraspeak sends a webhook (a failure created, a buy order received, a scheduled work completed, and so on: 47 events).

Infraspeak has no API for creating webhooks, so you set them up by hand:

1. Add **Infraspeak Trigger** to a workflow and copy its **Production URL**.
2. In Infraspeak, go to **Settings → Integrations → Webhooks** and click **Create Webhook**. Paste the URL, pick the event, and leave the method as POST (PUT also works).
3. Optional but recommended: set a **secret** there (6–255 characters). Then create an **Infraspeak Webhook API** credential in n8n with the same secret and select it on the trigger. The trigger then rejects any delivery whose `X-Hook-Secret` signature doesn't match, with a 401. Without a secret, it accepts every request to the URL.
4. Activate the workflow.

One Infraspeak webhook sends one event. To cover several events, create several webhooks pointing at the same URL, and use the trigger's **Events** field to choose which of them start the workflow. Leave it empty to accept all.

**Good to know**
- **Output:** with **Simplify** on, you get the record as `{ id, type, ...attributes }` plus `event` (the `X-Is-Topic` header) and `deliveryId` (`X-Request-Uuid`). The body carries only the record's attributes; use the Infraspeak node to fetch related records.
- **Duplicates:** Infraspeak delivers at least once, and retries keep the same `deliveryId`. Dedupe on it if a duplicate would cause harm.
- **Two runs for one change:** subscribing to a *State Changed* event and a specific one (e.g. *Failure Closed*) sends two deliveries for one change.
- **Webhooks can switch off:** Infraspeak retries failed deliveries for about 5.5 days, then sets the webhook to inactive and emails your admins. The trigger replies straight away, but if n8n is down or the URL changes (for example a new workflow), re-enable the webhook in Infraspeak.
- **Unverified:** the docs don't say whether the signature is hex or base64, so the trigger accepts both. Infraspeak's webhook logs (**Settings → Integrations → Webhook logs**) show the real header.

## Usage

- **Simplify** (on by default) flattens each JSON:API record to `{ id, ...attributes }`. Turn it off to get the raw record, including `type` and `relationships`.
- The API allows 60 requests per minute. Return All makes one request per 200 records.
- Date filters are sent in Infraspeak's `YYYY-MM-DD HH:MM:SS` format.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Infraspeak developer documentation](https://developer.infraspeak.com/documentation)

## Development

Most of the node is generated from Infraspeak's OpenAPI spec. Don't edit `nodes/Infraspeak/resources/*.ts` by hand.

- `docs/api/openapi-full.yaml` is the spec (git-ignored; download it from https://developer.infraspeak.com/api/openapi.yaml).
- `scripts/generate/overrides.ts` holds every decision the spec can't make: which resources are enabled, names for non-CRUD actions, dropdown fields, labels, and API-wide rules such as the filter prefix and date-range params.
- `npm run generate` rewrites `nodes/Infraspeak/resources/` and `test/generated/manifest.json`. It fails loudly on anything it can't map, rather than guessing.
- To add a resource, add its OpenAPI tag to `resources` in `overrides.ts`, run `npm run generate`, then add overrides until it generates and `npm run lint` passes.

Checks:

- `npm run test:mock` runs every operation against the Prism mock (start `npm run mock` first). Prism rejects any request that breaks the spec, so this is a second opinion next to `npm test`. Optional date fields are left out, because the date format is a known conflict between the spec and the docs.

- `npm test` runs every generated operation through n8n's real execution engine with HTTP mocked. It checks that the node sends the method, path, query and body the spec describes, and validates bodies against the spec's JSON schema. This proves the node matches the spec, not that the live API matches the spec. That still needs a run against a sandbox account.
- `npm run lint` and `npm run build`.

### Testing without a token

`npm run mock` serves a fake Infraspeak API on `http://127.0.0.1:4010`. It's generated from the spec with [Prism](https://github.com/stoplightio/prism), so you can click through the node in n8n without an account.

1. Download the spec to `docs/api/openapi-full.yaml` (see above).
2. Run `npm run mock` and leave it running.
3. In n8n, create an Infraspeak API credential:
   - Access Token: any value.
   - Base URL: `http://127.0.0.1:4010`. Use the IP, not `localhost`: Prism listens on IPv4 only, and n8n resolves `localhost` to IPv6 `::1`, so the connection is refused.
4. Use the node as normal.

Responses come from the spec's examples, so each list usually has a single record, and the IDs look real (e.g. client `10959`). The mock doesn't store anything: Get returns the same example record whatever you created.

`npm run mock:random` generates random data instead. It gives more variety, but IDs are filler text such as `"ipsum"`, which Create and Update reject because they expect integer IDs.

Prism's terminal flags any request that doesn't match the spec with a red `Violation` line.

The mock agrees with the spec by construction. It can't show where the live API differs, for example in the filter prefix or the date format. That still needs a real account.

### Verifying against the live API

Several API details the node relies on aren't settled by the spec: filter names, date format, how multi-value filters are sent, the dropdown searches and `is_real`. Once you have a token, one read-only run checks them all:

```bash
INFRASPEAK_TOKEN=<your token> npm run verify
#   -- --only filters,dates   run some sections only (lists always runs: it supplies the sample data)
```

- Sends **GET requests only** and never prints the token. It waits 1.1 s between requests (the API allows 60 per minute), so a full run takes about 5 minutes.
- For each filter it picks a real value from your data, sends it the way the node does and the alternative way, and checks whether results actually narrowed.
- Ends with a **Decisions** block saying what to change, e.g. `apiRules.filterPrefix` in `scripts/generate/overrides.ts`. After changing it, run `npm run generate` and the tests.
- Writes `verify-report.json` with every probe. It's gitignored because it holds values from your account.
- Things it can't check without writing data are listed at the end: fields Update requires, Create/Update/Delete payloads, and the trigger's signature encoding.

Against the mock (`INFRASPEAK_TOKEN=x INFRASPEAK_BASE_URL=http://127.0.0.1:4010 npm run verify`), most filter probes are inconclusive, because each example list has a single record. Four lists and gets also fail there because of placeholder values in the spec's examples. That run only shows the script works.

### Testing the trigger without Infraspeak

`npm run webhook:send` posts a sample delivery with Infraspeak's headers to a trigger URL:

```bash
npm run webhook:send -- http://localhost:5678/webhook-test/<id>/webhook --secret abcdef123
#   --event FAILURE_CLOSED   event header (default FAILURE_CREATED)
#   --method PUT             send as PUT
#   --bad-signature          sign with the wrong secret (expect 401)
```
