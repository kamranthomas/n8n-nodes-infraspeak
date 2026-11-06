# n8n-nodes-infraspeak

This is an n8n community node. It lets you use [Infraspeak](https://infraspeak.com) in your n8n workflows.

Infraspeak is a maintenance management platform (CMMS). This node manages **failures** (Infraspeak's corrective work orders), **clients**, **elements** (assets) and **problem** areas/types.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Usage](#usage)
[Resources](#resources)
[Development](#development)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

**Client**: Create, Get, Get Many, Update, Delete, Associate Contacts

**Element (Asset)**: Create, Get, Get Many, Update, Delete, Archive, Unarchive

**Failure**

- **Create**: create a failure for a client and location, with a problem type and priority
- **Get**: get a failure by numeric ID or UUID
- **Get Many**: list all, open, or closed failures. You can filter by status, location, problem type, and date ranges (reported, completed, approved, status changed). Return All pages through the API 200 records at a time.
- **Update**: update a failure's fields, such as priority, description, location, and closing note

**Problem**: Get Many Areas, Get Area, Get Many Types

Client, Location, Problem Area and Problem Type fields are searchable dropdowns, or you can enter an ID directly. The Location list only shows real locations, because failures and assets can't be attached to buildings or folders. Problem types only exist inside a problem area, so to pick a Problem Type from the list, choose a Problem Area first. The Problem Area field only narrows the list and isn't sent to Infraspeak.

Delete returns `{ "deleted": true }`; Archive and Unarchive return `{ "success": true }`.

## Credentials

The node authenticates with a bearer token.

1. In Infraspeak, create a Personal Access Token (see [Using the token](https://developer.infraspeak.com/documentation/authentication/using-the-token)).
2. In n8n, create an **Infraspeak API** credential and paste the token into **Access Token**.

Leave **Base URL** at its default (`https://api.infraspeak.com/v3`) unless you're pointing at a sandbox or the local mock described under Development.

The credential test calls `GET /locations?limit=1`.

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

- `npm test` runs every generated operation through n8n's real execution engine with HTTP mocked. It checks that the node sends the method, path, query and body the spec describes, and validates bodies against the spec's JSON schema. This proves the node matches the spec, not that the live API matches the spec. That still needs a run against a sandbox account.
- `npm run lint` and `npm run build`.

### Testing without a token

`npm run mock` serves a fake Infraspeak API on `http://localhost:4010`. It's generated from the spec with [Prism](https://github.com/stoplightio/prism), so you can click through the node in n8n without an account.

1. Download the spec to `docs/api/openapi-full.yaml` (see above).
2. Run `npm run mock` and leave it running.
3. In n8n, create an Infraspeak API credential:
   - Access Token: any value.
   - Base URL: `http://localhost:4010`.
4. Use the node as normal.

Responses are random data in the spec's shape: IDs and names are filler text. Prism's terminal flags any request that doesn't match the spec, but the request still goes through.

The mock agrees with the spec by construction. It can't show where the live API differs, for example in the filter prefix or the date format. That still needs a real account.
