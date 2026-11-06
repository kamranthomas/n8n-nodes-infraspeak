import type { INodeProperties } from 'n8n-workflow';
import {
	clientIdField,
	enforceNfcField,
	failureIdField,
	locationIdField,
	numberBodyField,
	priorityOptions,
	problemIdDescription,
	simplifyField,
	stringBodyField,
} from './shared';

const showOnlyForFailureUpdate = {
	resource: ['failure'],
	operation: ['update'],
};

export const failureUpdateDescription: INodeProperties[] = [
	{
		...failureIdField,
		displayOptions: { show: showOnlyForFailureUpdate },
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: showOnlyForFailureUpdate },
		options: [
			clientIdField,
			stringBodyField(
				'Closing Note',
				'lastStatusDescription',
				'last_status_description',
				'Observation for the closing action of the failure',
				true,
			),
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
			stringBodyField(
				'External ID',
				'externalId',
				'external_id',
				'ID of the failure in an external system',
			),
			numberBodyField(
				'Gatekeeper ID',
				'gatekeeperId',
				'gatekeeper_id',
				'ID of the associated gatekeeper',
			),
			locationIdField,
			stringBodyField(
				'Observations',
				'observations',
				'observations',
				'Longer text with anything else that needs to be reported',
				true,
			),
			{
				displayName: 'Priority',
				name: 'priority',
				type: 'options',
				options: priorityOptions,
				default: 1,
				description: 'Failure priority, 1 being the lowest and 4 the highest',
				routing: { send: { type: 'body', property: 'priority' } },
			},
			numberBodyField('Problem ID', 'problemId', 'problem_id', problemIdDescription),
			numberBodyField(
				'Supplier ID',
				'supplierId',
				'supplier_id',
				'ID of the supplier associated with the failure',
			),
		],
	},
	simplifyField(['update']),
];
