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

export type LocatorKey =
	| 'client'
	| 'location'
	| 'problemArea'
	| 'problemType'
	| 'supplier'
	| 'operator'
	| 'costCenter'
	| 'category'
	| 'warehouse';

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
	supplier: {
		displayName: 'Supplier',
		fieldName: 'supplierId',
		listSearch: 'getSuppliers',
		description: 'The supplier',
	},
	operator: {
		displayName: 'Operator',
		fieldName: 'operatorId',
		listSearch: 'getOperators',
		description: 'The operator (technician or user)',
	},
	costCenter: {
		displayName: 'Cost Center',
		fieldName: 'costCenterId',
		listSearch: 'getCostCenters',
		description: 'The cost center',
	},
	category: {
		displayName: 'Category',
		fieldName: 'categoryId',
		listSearch: 'getCategories',
		description: 'The category',
	},
	warehouse: {
		displayName: 'Warehouse',
		fieldName: 'warehouseId',
		listSearch: 'getWarehouses',
		description: 'The warehouse',
	},
};

/** Body/query property → locator, applied in every resource. */
export const propertyLocators: Record<string, LocatorKey> = {
	client_id: 'client',
	local_id: 'location',
	problem_id: 'problemType',
	'filter[client_id]': 'client',
	supplier_id: 'supplier',
	operator_id: 'operator',
	cost_center_id: 'costCenter',
	category_id: 'category',
	s_category_id: 'category',
	warehouse_id: 'warehouse',
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
	cost_center_id: { description: 'The associated cost center' },
	supplier_id: { description: 'The associated supplier' },
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
	/** Treat as a list (Get Many with Return All/Limit) even if the spec's shape doesn't say so. */
	list?: boolean;
	/** Output the response records even though the spec's response shape isn't a JSON:API record. */
	returnsRecords?: boolean;
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
		tag: 'Categories',
		value: 'category',
		displayName: 'Category',
		singular: 'category',
		plural: 'categories',
		operations: {
			getCategories: {
				description: "Get many top-level ('folder') categories",
			},
			getAllCategories: {
				value: 'getAllFlat',
				name: 'Get Many (All Levels)',
				action: 'Get many categories at all levels',
				description: 'Get many categories at every level, not only the top-level folders',
			},
			getCategoryChildren: {
				value: 'getChildren',
				name: 'Get Children',
				action: 'Get the children of a category',
				description: 'Get the categories one level below a category',
				list: true,
				pathLocators: { category: 'category' },
			},
			getCategory: { pathLocators: { category: 'category' } },
			updateCategory: { pathLocators: { category: 'category' } },
			deleteCategory: { pathLocators: { category: 'category' } },
		},
		fields: {
			filteredByTechnicalSkills: {
				displayName: 'Assignable to Technical Skills Only',
				description:
					'Whether to return only categories assignable to technical skills, with their ancestors',
			},
			s_is_real: { displayName: 'Is Real', description: 'Whether the category is real' },
			sc_type_equipment: {
				displayName: 'Equipment Only',
				description: 'Whether to return only equipment-type categories',
			},
			empty_folders: {
				displayName: 'Include Empty Folders',
				description: 'Whether to include categories that have no children',
			},
		},
	},
	{
		tag: 'Contacts',
		value: 'contact',
		displayName: 'Contact',
		singular: 'contact',
		plural: 'contacts',
	},
	{
		tag: 'Cost Centers',
		value: 'costCenter',
		displayName: 'Cost Center',
		singular: 'cost center',
		plural: 'cost centers',
		operations: {
			getCostCenter: { pathLocators: { costCenterId: 'costCenter' } },
			updateCostCenter: { pathLocators: { costCenterId: 'costCenter' } },
			deleteCostCenter: { pathLocators: { costCenterId: 'costCenter' } },
		},
	},
	{
		tag: 'Files',
		value: 'file',
		displayName: 'File',
		singular: 'file',
		plural: 'files',
		operations: {
			getFiles: {
				value: 'getAll',
				name: 'Get Many',
				action: 'Get many files',
				description: 'Get the files attached to an Infraspeak object',
				list: true,
				pathDisplayNames: { relatedTo: 'Related To', relatedToId: 'Related To ID' },
			},
		},
	},
	{
		tag: 'Locations',
		value: 'location',
		displayName: 'Location',
		singular: 'location',
		plural: 'locations',
		operations: {
			getLocations: {
				list: true,
				description: 'Get many locations: buildings, folders and locations',
			},
			getLocationsBuildings: {
				value: 'getManyBuildings',
				name: 'Get Many Buildings',
				action: 'Get many buildings',
				description: 'Get many locations of type building',
			},
			getLocationChildren: {
				value: 'getChildren',
				name: 'Get Children',
				action: 'Get the children of a location',
				description: 'Get the locations one level below a location',
				list: true,
				pathDisplayNames: { id: 'Location ID' },
			},
			updateMultipleLocations: {
				value: 'updateMany',
				name: 'Update Many',
				action: 'Update many locations',
				description: 'Update several locations in one request',
			},
			duplicateBuilding: {
				value: 'duplicateBuilding',
				name: 'Duplicate Building',
				action: 'Duplicate a building',
				description: 'Create a building as a copy of an existing one',
			},
			getLocation: { pathDisplayNames: { id: 'Location ID' } },
			updateLocation: { pathDisplayNames: { id: 'Location ID' } },
			deleteLocation: { pathDisplayNames: { id: 'Location ID' } },
		},
		fields: {
			is_real: {
				displayName: 'Real Locations Only',
				description: 'Whether to return only real locations, not buildings or folders',
			},
			s_with_assets_count: {
				displayName: 'Include Asset Count',
				description:
					'Whether to include each location’s cumulative asset count, including descendant locations',
			},
			with_assets_count: {
				displayName: 'Include Asset Count',
				description:
					'Whether to include each location’s cumulative asset count, including descendant locations',
			},
			force: {
				description: 'Whether to delete the location even if it has active dependencies',
			},
			locations: {
				description: 'Array of locations to update, each with its location_id',
			},
		},
	},
	{
		tag: 'Stocks',
		value: 'stockStatus',
		displayName: 'Stock Status',
		singular: 'stock status',
		plural: 'stock statuses',
		operations: {
			updateStockStatus: { pathDisplayNames: { stockStatus: 'Stock Status ID' } },
			deleteStockStatus: { pathDisplayNames: { stockStatus: 'Stock Status ID' } },
		},
	},
	{
		tag: 'Stock Transactions',
		value: 'stockTransaction',
		displayName: 'Stock Transaction',
		singular: 'stock transaction',
		plural: 'stock transactions',
		operations: {
			getAllStockTransactions: {
				value: 'getAll',
				name: 'Get Many',
				action: 'Get many stock transactions',
				description: 'Get many stock transactions',
				list: true,
			},
			getAllStockTransactionBatches: {
				value: 'getManyBatches',
				name: 'Get Many Batches',
				action: 'Get many stock transaction batches',
				description: 'Get many stock transaction batches',
				list: true,
			},
			stockTransactionsTransfer: {
				value: 'transfer',
				name: 'Transfer',
				action: 'Transfer stock between warehouses',
				description: 'Transfer stock between warehouses',
			},
			stockTransactionsTransferAll: {
				value: 'transferAll',
				name: 'Transfer All',
				action: 'Transfer all stock between warehouses',
				description: 'Transfer all the stock of one warehouse to another',
			},
		},
	},
	{
		tag: 'Warehouses',
		value: 'warehouse',
		displayName: 'Warehouse',
		singular: 'warehouse',
		plural: 'warehouses',
		operations: {
			getStockWarehouse: { pathLocators: { warehouseId: 'warehouse' } },
			updateStockWarehouse: { pathLocators: { warehouseId: 'warehouse' } },
			deleteStockWarehouse: { pathLocators: { warehouseId: 'warehouse' } },
			getStockWarehousesRegistry: {
				value: 'getRegistry',
				name: 'Get Registry',
				action: 'Get the registry of a warehouse',
				description: 'Get the stock movement registry of a warehouse',
				pathLocators: { warehouseId: 'warehouse' },
			},
			postStockWarehousesStockTransactions: {
				value: 'addStockTransaction',
				name: 'Add Stock Transaction',
				action: 'Add a stock transaction to a warehouse',
				description: 'Create a stock transaction in a warehouse',
				pathLocators: { warehouseId: 'warehouse' },
			},
			getWarehousesAssociations: {
				value: 'checkAssociations',
				name: 'Check Associations',
				action: 'Check whether a warehouse has dependencies',
				description: 'Check whether a warehouse has dependencies, e.g. before deleting it',
				pathLocators: { warehouseId: 'warehouse' },
				returnsRecords: false,
			},
			deleteWarehouseAssociatedOperator: {
				value: 'removeOperator',
				name: 'Remove Operator',
				action: 'Remove an operator from a warehouse',
				description: 'Remove the association between an operator and a warehouse',
				pathLocators: { warehouseId: 'warehouse', operatorId: 'operator' },
			},
		},
	},
	{
		tag: 'Operators',
		value: 'operator',
		displayName: 'Operator',
		singular: 'operator',
		plural: 'operators',
		operations: {
			getOperator: { pathLocators: { operator: 'operator' } },
		},
	},
	{
		tag: 'Other Costs',
		value: 'otherCost',
		displayName: 'Other Cost',
		singular: 'other cost',
		plural: 'other costs',
		fields: {
			failure: {
				displayName: 'Usable in Work Orders',
				description: 'Whether the cost can be included in corrective maintenance (work order) costs',
			},
			schedule_work: {
				displayName: 'Usable in Planned Jobs',
				description:
					'Whether the cost can be included in preventive maintenance (planned job order) costs',
			},
			operator: {
				displayName: 'Usable for Operators',
				description: 'Whether the cost can be included in individual operator costs',
			},
			element: {
				displayName: 'Usable for Assets',
				description: 'Whether the cost can be included in asset costs',
			},
		},
	},
	{
		tag: 'Requests',
		value: 'request',
		displayName: 'Request',
		singular: 'request',
		plural: 'requests',
	},
	{
		tag: 'Scheduled Works',
		value: 'scheduledWork',
		displayName: 'Scheduled Work',
		singular: 'scheduled work',
		plural: 'scheduled works',
	},
	{
		tag: 'Suppliers',
		value: 'supplier',
		displayName: 'Supplier',
		singular: 'supplier',
		plural: 'suppliers',
		operations: {
			getSupplier: { pathLocators: { supplier: 'supplier' } },
			updateSupplier: { pathLocators: { supplier: 'supplier' } },
			deleteSupplier: { pathLocators: { supplier: 'supplier' } },
		},
		fields: {
			add_to_market: {
				description:
					'Whether to list the supplier on the Infraspeak Market, where other Infraspeak Network users can find and request their services',
			},
		},
	},
	{
		tag: 'Works',
		value: 'work',
		displayName: 'Work',
		singular: 'work',
		plural: 'works',
		fields: {
			any_responsible: {
				displayName: 'Anyone Can Start',
				description:
					'Whether anyone can start the planned job. If off, Operator ID or Technical Skill ID must be set.',
			},
			auto_close: {
				description:
					'Whether the planned job order closes automatically when all tasks are completed. Only for Cyclic or Plan types.',
			},
			auto_pilot: {
				description: 'Whether any user can start this planned job. Only for Cyclic or Plan types.',
			},
			is_protected: {
				description: 'Whether the planned job is protected from being edited or deleted by managers',
			},
			local_id: { displayName: 'Location IDs', description: 'Comma-separated location IDs' },
			gatekeeper_notification: {
				displayName: 'Gatekeeper Notification IDs',
				description: 'Comma-separated notification IDs to dispatch under the gatekeeper',
			},
		},
	},
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
			category_id: { description: 'The asset category' },
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
				description: 'The operator who owns the failure. Defaults to the operator of the API token.',
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
