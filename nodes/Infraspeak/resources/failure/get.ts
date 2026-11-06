import type { INodeProperties } from 'n8n-workflow';
import { failureIdField, simplifyField } from './shared';

export const failureGetDescription: INodeProperties[] = [
	{
		...failureIdField,
		displayOptions: { show: { resource: ['failure'], operation: ['get'] } },
	},
	simplifyField(['get']),
];
