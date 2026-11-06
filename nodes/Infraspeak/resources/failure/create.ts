import type { INodeProperties } from 'n8n-workflow';
import {
	clientIdField,
	enforceNfcField,
	locationIdField,
	numberBodyField,
	priorityOptions,
	problemIdDescription,
	simplifyField,
	stringBodyField,
} from './shared';

const showOnlyForFailureCreate = {
	resource: ['failure'],
	operation: ['create'],
};

export const failureCreateDescription: INodeProperties[] = [
	{
		...clientIdField,
		required: true,
		displayOptions: { show: showOnlyForFailureCreate },
	},
	{
		...locationIdField,
		required: true,
		displayOptions: { show: showOnlyForFailureCreate },
	},
	{
		displayName: 'Problem ID',
		name: 'problemId',
		type: 'number',
		required: true,
		default: 0,
		description: problemIdDescription,
		displayOptions: { show: showOnlyForFailureCreate },
		routing: { send: { type: 'body', property: 'problem_id' } },
	},
	{
		displayName: 'Priority',
		name: 'priority',
		type: 'options',
		required: true,
		options: priorityOptions,
		default: 1,
		description: 'Failure priority, 1 being the lowest and 4 the highest',
		displayOptions: { show: showOnlyForFailureCreate },
		routing: { send: { type: 'body', property: 'priority' } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: showOnlyForFailureCreate },
		options: [
			numberBodyField(
				'Cost Center ID',
				'costCenterId',
				'cost_center_id',
				'ID of the associated cost center',
			),
			stringBodyField(
				'Description',
				'description',
				'description',
				'A more detailed description of the reported incident',
			),
			enforceNfcField,
			numberBodyField(
				'Gatekeeper ID',
				'gatekeeperId',
				'gatekeeper_id',
				'ID of the associated gatekeeper',
			),
			{
				displayName: 'Include Automatic Assignees',
				name: 'includeAutomaticAssignees',
				type: 'boolean',
				default: false,
				description: 'Whether to append automatic assignees to a custom list of assignees',
				routing: { send: { type: 'body', property: 'include_automatic_assignees' } },
			},
			stringBodyField(
				'Observations',
				'observations',
				'observations',
				'Longer text with anything else that needs to be reported',
				true,
			),
			numberBodyField(
				'Operator ID',
				'operatorId',
				'operator_id',
				'ID of the operator who owns the failure. Defaults to the operator of the API token.',
			),
			{
				displayName: 'Report Type',
				name: 'reportType',
				type: 'options',
				options: [
					{ name: 'Contact', value: 'contact' },
					{ name: 'Operator', value: 'operator' },
				],
				default: 'operator',
				description: 'Whether the failure was reported by an operator or a contact',
				routing: { send: { type: 'body', property: 'report_type' } },
			},
			numberBodyField(
				'Reporter ID',
				'reportId',
				'report_id',
				'ID of the operator or contact who reported the failure (see Report Type)',
			),
			numberBodyField(
				'Supplier ID',
				'supplierId',
				'supplier_id',
				'ID of the supplier associated with the failure',
			),
		],
	},
	simplifyField(['create']),
];
