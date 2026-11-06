# n8n-nodes-infraspeak

This is an n8n community node. It lets you use [Infraspeak](https://infraspeak.com) in your n8n workflows.

Infraspeak is a maintenance management platform (CMMS). This node manages **failures**, which are Infraspeak's corrective work orders.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Usage](#usage)
[Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

**Failure**

- **Create**: create a failure for a client and location, with a problem type and priority
- **Get**: get a failure by numeric ID or UUID
- **Get Many**: list all, open, or closed failures. You can filter by status, location, problem type, and reported/completed date ranges. Return All pages through the API 200 records at a time.
- **Update**: update a failure's fields, such as priority, description, location, and closing note

The Client and Location fields are searchable dropdowns, or you can enter an ID directly. The Location list only shows real locations, because failures can't be attached to buildings or folders.

## Credentials

The node authenticates with a bearer token.

1. In Infraspeak, create a Personal Access Token (see [Using the token](https://developer.infraspeak.com/documentation/authentication/using-the-token)).
2. In n8n, create an **Infraspeak API** credential and paste the token into **Access Token**.

The credential test calls `GET /locations?limit=1`.

## Usage

- **Simplify** (on by default) flattens each JSON:API record to `{ id, ...attributes }`. Turn it off to get the raw record, including `type` and `relationships`.
- **Problem ID** must be a problem _type_, not a problem area. You can find it with `GET /problems/{problem_id}/subproblems`.
- The API allows 60 requests per minute. Return All over a large account makes one request per 200 failures.
- Date filters are sent in Infraspeak's `YYYY-MM-DD HH:MM:SS` format.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Infraspeak developer documentation](https://developer.infraspeak.com/documentation)
