/**
 * Every human decision the generator can't take from the OpenAPI spec lives here.
 *
 * When the live API turns out to differ from the spec, fix it here (globally if
 * it's an API-wide rule) and re-run `npm run generate`.
 */

export const SPEC_PATH = 'docs/api/openapi-full.yaml';
export const SPEC_URL = 'https://developer.infraspeak.com/api/openapi.yaml';

// ─── API-wide rules ──────────────────────────────────────────────────────────

export const apiRules = {
	/**
	 * Prefix for plain equality filters on list endpoints. The spec lists bare names
	 * (`local_id`), the developer docs describe `s_local_id`. Unverified: change to
	 * 's_' if the live API ignores bare names.
	 */
	filterPrefix: '',
	/** Date-time query params become After/Before range filters using these prefixes (from the docs). */
	dateRange: { min: 'date_min_', max: 'date_max_' },
	/** Query params that go under "Options" instead of "Filters". */
	optionParams: ['expanded', 'sort'],
};

// ─── Resource locators (searchable dropdowns) ────────────────────────────────

export type LocatorKey = 'client' | 'location' | 'problemArea' | 'problemType';

export interface LocatorConfig {
	displayName: string;
	/** n8n parameter name used for this locator everywhere. */
	fieldName: string;
	/** Method in nodes/Infraspeak/listSearch/index.ts. */
	listSearch: string;
	description: string;
	/** Another locator whose value narrows this list. Emitted as a UI-only field just before this one. */
	dependsOn?: LocatorKey;
}

export const locators: Record<LocatorKey, LocatorConfig> = {
	client: {
		displayName: 'Client',
		fieldName: 'clientId',
		listSearch: 'getClients',
		description: 'The client',
	},
	location: {
		displayName: 'Location',
		fieldName: 'locationId',
		listSearch: 'getLocations',
		description: 'The location. Must be a location, not a building or folder.',
	},
	problemArea: {
		displayName: 'Problem Area',
		fieldName: 'problemAreaId',
		listSearch: 'getProblemAreas',
		description: 'The problem area',
	},
	problemType: {
		displayName: 'Problem Type',
		fieldName: 'problemId',
		listSearch: 'getProblemTypes',
		description:
			'The problem type. To pick from the list, choose a Problem Area first, or switch to By ID.',
		dependsOn: 'problemArea',
	},
};

/** Body/query property → locator, applied in every resource. */
export const propertyLocators: Record<string, LocatorKey> = {
	client_id: 'client',
	local_id: 'location',
	problem_id: 'problemType',
	'filter[client_id]': 'client',
};

// ─── Field overrides ─────────────────────────────────────────────────────────

export interface FieldOverride {
	displayName?: string;
	/** Override the n8n parameter name. */
	name?: string;
	description?: string;
	options?: Array<{ name: string; value: string | number }>;
	/** Drop the field from the node. */
	skip?: boolean;
	/** Force (or with `null`, prevent) a resource locator. */
	locator?: LocatorKey | null;
	/** For date-time query params: label stem for the After/Before pair (e.g. "Reported"). */
	dateLabel?: string;
	multiline?: boolean;
}

/** Field overrides applied in every resource, keyed by spec property/param name. */
export const globalFields: Record<string, FieldOverride> = {
	enforce_nfc: {
		displayName: 'Enforce NFC',
		description:
			"Whether the asset's NFC tag must be scanned to execute the tasks of this work order. Only admins and managers can set it.",
	},
	priority: {
		description: 'Priority, 1 being the lowest and 4 the highest',
		options: [
			{ name: '1 – Lowest', value: 1 },
			{ name: '2', value: 2 },
			{ name: '3', value: 3 },
			{ name: '4 – Highest', value: 4 },
		],
	},
	description: { multiline: false },
	observations: { multiline: true },
	observation: { multiline: true },
	cost_center_id: {
		displayName: 'Cost Center ID',
		description: 'ID of the associated cost center',
	},
	supplier_id: { displayName: 'Supplier ID', description: 'ID of the associated supplier' },
	gatekeeper_id: { displayName: 'Gatekeeper ID', description: 'ID of the associated gatekeeper' },
	expanded: {
		displayName: 'Expand Relations',
		description: 'Comma-separated list of relations to include, e.g. failure_elements.element',
	},
	sort: {
		description: 'Field to sort by. Add "-" at the end to sort descending, e.g. name-.',
	},
	nif: { displayName: 'NIF (VAT Number)', description: 'NIF / VAT number' },
};

// ─── Operations and resources ────────────────────────────────────────────────

export interface OperationOverride {
	/** n8n operation value. Required for operations that aren't plain CRUD. */
	value?: string;
	name?: string;
	action?: string;
	description?: string;
	skip?: boolean;
	/** Path param → locator, so the user picks the record from a list. */
	pathLocators?: Record<string, LocatorKey>;
	/** Display name for a plain path-param ID field. */
	pathDisplayNames?: Record<string, string>;
	fields?: Record<string, FieldOverride>;
}

export interface ListVariants {
	/** Selector parameter shown on the merged Get Many operation. */
	selector: { name: string; displayName: string; description: string };
	/** operationId → selector option. The first one is the default. */
	variants: Record<string, { value: string; name: string; description: string }>;
}

export interface ResourceConfig {
	/** OpenAPI tag. */
	tag: string;
	value: string;
	displayName: string;
	singular: string;
	plural: string;
	/** operationId → override. */
	operations?: Record<string, OperationOverride>;
	/** Field overrides for this resource only, keyed by spec property/param name. */
	fields?: Record<string, FieldOverride>;
	/** Several list endpoints merged into one Get Many with a selector. */
	listVariants?: ListVariants;
}

/** Resources enabled in the node. Add a tag here and regenerate to widen coverage. */
export const resources: ResourceConfig[] = [
	{
		tag: 'Clients',
		value: 'client',
		displayName: 'Client',
		singular: 'client',
		plural: 'clients',
		operations: {
			getClient: { pathLocators: { client: 'client' } },
			updateClient: { pathLocators: { client: 'client' } },
			deleteClient: { pathLocators: { client: 'client' } },
			syncContacts: {
				value: 'associateContacts',
				name: 'Associate Contacts',
				action: 'Associate contacts with a client',
				description: 'Associate a list of contacts with a client',
				pathLocators: { client: 'client' },
			},
		},
		fields: {
			name: { description: 'Name of the client' },
			code: { description: 'Client code' },
			address: { description: 'Address of the client' },
			post_code: { displayName: 'Postal Code', description: 'Postal code of the client' },
			city: { description: 'City of the client' },
			country: { description: 'Country as an ISO 3166-1 alpha-2 code, e.g. PT' },
			latitude: { description: 'Latitude of the client' },
			longitude: { description: 'Longitude of the client' },
			observations: { description: 'Additional information' },
			create_building: {
				description: 'Whether to also create a building for the client',
			},
			local_id: {
				locator: null,
				displayName: 'Building to Copy ID',
				description: 'ID of the building to copy information from when Create Building is on',
			},
			contacts: {
				displayName: 'Contact IDs',
				description: 'Comma-separated contact IDs to associate',
			},
			operators: {
				displayName: 'Operator IDs',
				description: 'Comma-separated operator IDs to associate',
			},
			contact_ids: {
				displayName: 'Contact IDs',
				description: 'Comma-separated contact IDs to associate with the client',
			},
			client_id: {
				locator: null,
				displayName: 'Client ID',
				description: 'Only the client with this ID',
			},
		},
	},
	{
		tag: 'Elements',
		value: 'element',
		displayName: 'Element (Asset)',
		singular: 'element',
		plural: 'elements',
		operations: {
			archiveElement: {
				value: 'archive',
				name: 'Archive',
				action: 'Archive an element',
				description: 'Archive an element (asset)',
			},
			unarchiveElement: {
				value: 'unarchive',
				name: 'Unarchive',
				action: 'Unarchive an element',
				description: 'Unarchive an element (asset)',
			},
		},
		fields: {
			category_id: { displayName: 'Category ID', description: 'ID of the asset category' },
			maintenance_policy_id: {
				displayName: 'Maintenance Policy ID',
				description: 'ID of the maintenance policy',
			},
			nfc_code: { displayName: 'NFC Code', description: 'NFC tag code' },
			bar_code: { displayName: 'Bar Code', description: 'Bar code' },
			code: { description: 'Element code' },
			observation: { description: 'Additional information' },
			latitude: { description: 'Latitude of the element' },
			longitude: { description: 'Longitude of the element' },
			acquisition_cost: { description: 'Acquisition cost' },
			acquisition_date: { description: 'Acquisition date' },
			supplier_name: { description: 'Name of the supplier' },
			lifetime: { description: 'Expected lifetime' },
			residual_value: { description: 'Residual value' },
			stoppage_cost: { description: 'Cost of a stoppage' },
			element_uuid: { displayName: 'Element UUID', description: 'UUID to give the element' },
		},
	},
	{
		tag: 'Failures',
		value: 'failure',
		displayName: 'Failure',
		singular: 'failure',
		plural: 'failures',
		listVariants: {
			selector: {
				name: 'statusGroup',
				displayName: 'Status Group',
				description: 'Which failures to return',
			},
			variants: {
				getFailures: {
					value: 'all',
					name: 'All',
					description: 'All failures, whatever their status',
				},
				getClosedFailures: {
					value: 'closed',
					name: 'Closed',
					description: 'Only failures in status Completed',
				},
				getOpenFailures: {
					value: 'open',
					name: 'Open',
					description: 'Only failures not in status Completed or Archived',
				},
			},
		},
		operations: {
			// Out of the agreed scope for now.
			deleteFailure: { skip: true },
			getFailure: { pathDisplayNames: { failure: 'Failure ID' } },
			updateFailure: { pathDisplayNames: { failure: 'Failure ID' } },
			createFailure: { description: 'Create a failure (work order)' },
		},
		fields: {
			description: { description: 'A more detailed description of the reported incident' },
			observations: { description: 'Longer text with anything else that needs to be reported' },
			operator_id: {
				displayName: 'Operator ID',
				description:
					'ID of the operator who owns the failure. Defaults to the operator of the API token.',
			},
			report_type: {
				description: 'Whether the failure was reported by an operator or a contact',
			},
			report_id: {
				displayName: 'Reporter ID',
				description: 'ID of the operator or contact who reported the failure (see Report Type)',
			},
			include_automatic_assignees: {
				description: 'Whether to append automatic assignees to a custom list of assignees',
			},
			last_status_description: {
				displayName: 'Closing Note',
				description: 'Observation for the closing action of the failure',
				multiline: true,
			},
			external_id: {
				displayName: 'External ID',
				description: 'ID of the failure in an external system',
			},
			gatekeeper_notification: {
				displayName: 'Gatekeeper Notification IDs',
				description: 'Comma-separated notification IDs to dispatch under the gatekeeper',
			},
			status: {
				description:
					'Only failures in this status. With Open, Completed and Archived return nothing.',
			},
			start_date: { dateLabel: 'Reported' },
			completed_date: { dateLabel: 'Completed' },
			approved_date: { dateLabel: 'Approved' },
			last_status_change_date: { dateLabel: 'Status Changed' },
			failure_id: { displayName: 'Failure ID', description: 'Only the failure with this ID' },
		},
	},
	{
		tag: 'Problems',
		value: 'problem',
		displayName: 'Problem',
		singular: 'problem',
		plural: 'problems',
		operations: {
			getProblemAreas: {
				value: 'getManyAreas',
				name: 'Get Many Areas',
				action: 'Get many problem areas',
				description: 'Get many problem areas',
			},
			getProblemArea: {
				value: 'getArea',
				name: 'Get Area',
				action: 'Get a problem area',
				description: 'Get a problem area',
				pathLocators: { problemAreaId: 'problemArea' },
			},
			getProblemTypes: {
				value: 'getManyTypes',
				name: 'Get Many Types',
				action: 'Get many problem types',
				description: 'Get the problem types in a problem area',
				pathLocators: { problemAreaId: 'problemArea' },
			},
		},
		fields: {
			'filter[network_only_with_client]': {
				displayName: 'Network Only With Client',
				description: 'Whether to only return network problem areas mapped to the client',
			},
		},
	},
];
