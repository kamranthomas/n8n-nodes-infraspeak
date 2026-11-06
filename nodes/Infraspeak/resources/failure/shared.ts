import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import { resourceLocatorIdExpression } from '../../shared/utils';

const numericIdValidation = [
	{
		type: 'regex' as const,
		properties: {
			regex: '^[0-9]+$',
			errorMessage: 'Not a valid ID: must be a number',
		},
	},
];

/** Failure ID used in the URL path. The API accepts the numeric ID or the UUID. */
export const failureIdField: INodeProperties = {
	displayName: 'Failure ID',
	name: 'failureId',
	type: 'string',
	required: true,
	default: '',
	placeholder: 'e.g. 234562',
	description: 'Numeric ID or UUID of the failure',
};

/** Client resourceLocator, sent to the API as integer `client_id`. */
export const clientIdField: INodeProperties = {
	displayName: 'Client',
	name: 'clientId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	description: 'The client the failure belongs to',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: {
				searchListMethod: 'getClients',
				searchable: true,
			},
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 123',
			validation: numericIdValidation,
		},
	],
	routing: {
		send: {
			type: 'body',
			property: 'client_id',
			value: resourceLocatorIdExpression,
		},
	},
};

/** Location resourceLocator, sent to the API as integer `local_id`. */
export const locationIdField: INodeProperties = {
	displayName: 'Location',
	name: 'locationId',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	description: 'The location of the failure. Must be a location, not a building or folder.',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			typeOptions: {
				searchListMethod: 'getLocations',
				searchable: true,
			},
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 123',
			validation: numericIdValidation,
		},
	],
	routing: {
		send: {
			type: 'body',
			property: 'local_id',
			value: resourceLocatorIdExpression,
		},
	},
};

export const priorityOptions: INodePropertyOptions[] = [
	{ name: '1 – Lowest', value: 1 },
	{ name: '2', value: 2 },
	{ name: '3', value: 3 },
	{ name: '4 – Highest', value: 4 },
];

export const problemIdDescription =
	'ID of the problem type (not a problem area). Find it via GET /problems/{problem_id}/subproblems.';

/** Builds a numeric body field for the Additional/Update Fields collections. */
export function numberBodyField(
	displayName: string,
	name: string,
	property: string,
	description: string,
): INodeProperties {
	return {
		displayName,
		name,
		type: 'number',
		default: 0,
		description,
		routing: { send: { type: 'body', property } },
	};
}

/** Builds a string body field for the Additional/Update Fields collections. */
export function stringBodyField(
	displayName: string,
	name: string,
	property: string,
	description: string,
	multiline = false,
): INodeProperties {
	return {
		displayName,
		name,
		type: 'string',
		default: '',
		description,
		...(multiline ? { typeOptions: { rows: 4 } } : {}),
		routing: { send: { type: 'body', property } },
	};
}

export const enforceNfcField: INodeProperties = {
	displayName: 'Enforce NFC',
	name: 'enforceNfc',
	type: 'boolean',
	default: false,
	description:
		"Whether the asset's NFC tag must be scanned to execute the tasks of this work order. Only admins and managers can set it.",
	routing: { send: { type: 'body', property: 'enforce_nfc' } },
};

/** Simplify toggle, read by the `unwrapJsonApi` postReceive hook. */
export function simplifyField(operation: string[]): INodeProperties {
	return {
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description:
			'Whether to return a flat object (ID plus attributes) instead of the raw JSON:API record',
		displayOptions: {
			show: {
				resource: ['failure'],
				operation,
			},
		},
	};
}
