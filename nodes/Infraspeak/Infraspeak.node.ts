import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from 'n8n-workflow';
import { listSearch } from './listSearch';
import { resourceProperties } from './resources';
import { INFRASPEAK_BASE_URL } from './shared/transport';

export class Infraspeak implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Infraspeak',
		name: 'infraspeak',
		// The logo is a solid badge that reads on both themes, so one file serves both.
		icon: { light: 'file:infraspeak.svg', dark: 'file:infraspeak.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Consume the Infraspeak API',
		defaults: {
			name: 'Infraspeak',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'infraspeakApi', required: true }],
		requestDefaults: {
			baseURL: INFRASPEAK_BASE_URL,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},
		properties: resourceProperties,
	};

	methods = {
		listSearch,
	};
}
