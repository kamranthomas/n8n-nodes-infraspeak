import type { INodeProperties } from 'n8n-workflow';
import { resourceLocatorIdExpression, toInfraspeakDateExpression } from '../../shared/utils';
import { locationIdField, simplifyField } from './shared';

/** Page size used when Return All paginates. Matches the API's default page size. */
const RETURN_ALL_PAGE_SIZE = 200;

const showOnlyForFailureGetMany = {
	resource: ['failure'],
	operation: ['getAll'],
};

function dateQueryFilter(
	displayName: string,
	name: string,
	property: string,
	description: string,
): INodeProperties {
	return {
		displayName,
		name,
		type: 'dateTime',
		default: '',
		description,
		routing: {
			send: { type: 'query', property, value: toInfraspeakDateExpression },
		},
	};
}

export const failureGetManyDescription: INodeProperties[] = [
	{
		displayName: 'Status Group',
		name: 'statusGroup',
		type: 'options',
		noDataExpression: true,
		options: [
			{
				name: 'All',
				value: 'all',
				description: 'All failures, whatever their status',
			},
			{
				name: 'Closed',
				value: 'closed',
				description: 'Only failures in status Completed',
			},
			{
				name: 'Open',
				value: 'open',
				description: 'Only failures not in status Completed or Archived',
			},
		],
		default: 'all',
		description: 'Which failures to return',
		displayOptions: { show: showOnlyForFailureGetMany },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: showOnlyForFailureGetMany },
		routing: {
			send: {
				paginate: '={{ $value }}',
			},
			operations: {
				pagination: {
					type: 'generic',
					properties: {
						// meta.pagination.total_pages is deprecated and unreliable; the API docs
						// say to stop once a page comes back with fewer items than the page size.
						continue: `={{ ($response.body.data ?? []).length === ${RETURN_ALL_PAGE_SIZE} }}`,
						request: {
							qs: {
								limit: RETURN_ALL_PAGE_SIZE,
								page: '={{ $pageCount + 1 }}',
							},
						},
					},
				},
			},
		},
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: {
			minValue: 1,
			maxValue: 2000,
		},
		description: 'Max number of results to return',
		displayOptions: {
			show: {
				...showOnlyForFailureGetMany,
				returnAll: [false],
			},
		},
		routing: {
			request: {
				qs: { page: 1 },
			},
			send: {
				type: 'query',
				property: 'limit',
			},
			output: {
				maxResults: '={{ $value }}',
			},
		},
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: showOnlyForFailureGetMany },
		options: [
			dateQueryFilter(
				'Completed After',
				'completedAfter',
				'date_min_completed_date',
				'Only failures completed on or after this date',
			),
			dateQueryFilter(
				'Completed Before',
				'completedBefore',
				'date_max_completed_date',
				'Only failures completed on or before this date',
			),
			{
				...locationIdField,
				description: 'Only failures at this location',
				routing: {
					send: { type: 'query', property: 'local_id', value: resourceLocatorIdExpression },
				},
			},
			{
				displayName: 'Problem ID',
				name: 'problemId',
				type: 'number',
				default: 0,
				description: 'Only failures with this problem type',
				routing: { send: { type: 'query', property: 'problem_id' } },
			},
			dateQueryFilter(
				'Reported After',
				'reportedAfter',
				'date_min_start_date',
				'Only failures reported on or after this date',
			),
			dateQueryFilter(
				'Reported Before',
				'reportedBefore',
				'date_max_start_date',
				'Only failures reported on or before this date',
			),
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Archived', value: 'ARCHIVED' },
					{ name: 'Completed', value: 'COMPLETED' },
					{ name: 'In Resolution', value: 'IN_RESOLUTION' },
					{ name: 'Paused', value: 'PAUSED' },
					{ name: 'Waiting Approval', value: 'WAITING_APPROVAL' },
					{ name: 'Waiting Resolution', value: 'WAITING_RESOLUTION' },
				],
				default: 'WAITING_RESOLUTION',
				description:
					'Only failures in this status. Not available for Closed. With Open, Completed and Archived return nothing.',
				displayOptions: {
					show: {
						'/statusGroup': ['all', 'open'],
					},
				},
				routing: { send: { type: 'query', property: 'status' } },
			},
		],
	},
	simplifyField(['getAll']),
];
