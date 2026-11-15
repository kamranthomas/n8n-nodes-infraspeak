# Changelog

## 0.1.0-beta.0 (2026-11-15)

First public beta. Built from Infraspeak's OpenAPI spec and checked against it and a mock server, but **not yet verified against the live Infraspeak API**.

- **Infraspeak** node: 24 resources and 124 operations, covering failures, works and scheduled works, clients, locations, assets, problems, categories, suppliers, operators, cost centers, other costs, contacts, requests, files, warehouses, stock and materials, quotes, and buy and sell orders.
- Searchable dropdowns for Client, Location, Problem Area and Type, Supplier, Operator, Cost Center, Category and Warehouse.
- **Infraspeak Trigger** node: starts workflows from Infraspeak webhooks (47 events), with optional signature checking.
- Credential with an optional Base URL, for a sandbox or a local mock.

Known open questions, to be settled with `npm run verify` against a live account:
- filter names (bare or `s_`-prefixed)
- the date format for date filters
- how multi-value filters are sent
- which fields Update requires
- the encoding of the webhook signature (hex or base64)
