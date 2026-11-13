import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';
import {
	INFRASPEAK_BASE_URL,
	INFRASPEAK_BASE_URL_EXPRESSION,
} from '../nodes/Infraspeak/shared/transport';

export class InfraspeakApi implements ICredentialType {
	name = 'infraspeakApi';

	displayName = 'Infraspeak API';

	icon: Icon = {
		light: 'file:../nodes/Infraspeak/infraspeak.svg',
		dark: 'file:../nodes/Infraspeak/infraspeak.svg',
	};

	documentationUrl =
		'https://github.com/kamranthomas/n8n-nodes-infraspeak?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'Personal Access Token (or JWT) from your Infraspeak account',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: INFRASPEAK_BASE_URL,
			description: 'Change only to use a sandbox or a local mock server',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.accessToken}}',
			},
		},
	};

	// The API has no /me endpoint; a one-record location list is the check the Infraspeak docs recommend.
	test: ICredentialTestRequest = {
		request: {
			baseURL: INFRASPEAK_BASE_URL_EXPRESSION,
			url: '/locations',
			method: 'GET',
			qs: { limit: 1 },
			headers: { Accept: 'application/json' },
		},
	};
}
