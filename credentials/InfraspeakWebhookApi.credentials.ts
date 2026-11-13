import type { ICredentialType, Icon, INodeProperties } from 'n8n-workflow';

/** The secret set on a webhook in Infraspeak, used by the trigger to check each delivery's signature. */
export class InfraspeakWebhookApi implements ICredentialType {
	name = 'infraspeakWebhookApi';

	displayName = 'Infraspeak Webhook API';

	icon: Icon = {
		light: 'file:../nodes/InfraspeakTrigger/infraspeak.svg',
		dark: 'file:../nodes/InfraspeakTrigger/infraspeak.svg',
	};

	documentationUrl =
		'https://github.com/kamranthomas/n8n-nodes-infraspeak?tab=readme-ov-file#trigger';

	properties: INodeProperties[] = [
		{
			displayName: 'Secret',
			name: 'secret',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'The secret set on the webhook in Infraspeak (Settings → Integrations → Webhooks), 6 to 255 characters',
		},
	];
}
