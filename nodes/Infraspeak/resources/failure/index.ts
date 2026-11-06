import type { INodeProperties } from 'n8n-workflow';
import { unwrapJsonApi } from '../../shared/utils';
import { failureCreateDescription } from './create';
import { failureGetDescription } from './get';
import { failureGetManyDescription } from './getAll';
import { failureUpdateDescription } from './update';

const output = {
	postReceive: [unwrapJsonApi],
};

export const failureDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: {
			show: { resource: ['failure'] },
		},
		options: [
			{
				name: 'Create',
				value: 'create',
				action: 'Create a failure',
				description: 'Create a failure (work order)',
				routing: {
					request: { method: 'POST', url: '/failures' },
					output,
				},
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a failure',
				description: 'Get a failure by ID or UUID',
				routing: {
					request: {
						method: 'GET',
						url: '=/failures/{{ encodeURIComponent($parameter.failureId) }}',
					},
					output,
				},
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many failures',
				description: 'Get many failures, optionally only open or closed ones',
				routing: {
					request: {
						method: 'GET',
						url: '=/failures{{ $parameter.statusGroup === "all" ? "" : "/" + $parameter.statusGroup }}',
					},
					output,
				},
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a failure',
				description: 'Update a failure',
				routing: {
					request: {
						method: 'PATCH',
						url: '=/failures/{{ encodeURIComponent($parameter.failureId) }}',
					},
					output,
				},
			},
		],
		default: 'getAll',
	},
	...failureCreateDescription,
	...failureGetDescription,
	...failureGetManyDescription,
	...failureUpdateDescription,
];
