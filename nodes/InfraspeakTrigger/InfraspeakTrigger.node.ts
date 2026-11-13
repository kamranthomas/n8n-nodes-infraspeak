import {
	NodeConnectionTypes,
	NodeOperationError,
	type ICredentialsDecrypted,
	type ICredentialTestFunctions,
	type IDataObject,
	type INodeCredentialTestResult,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
} from 'n8n-workflow';
import { eventOptions } from './events';
import { isValidSignature } from './signature';

interface JsonApiRecord {
	id?: unknown;
	type?: unknown;
	attributes?: IDataObject;
}

/**
 * Starts a workflow when Infraspeak sends a webhook. Infraspeak has no API to create
 * webhooks, so the user pastes this node's URL into Infraspeak's settings by hand and
 * there are no webhookMethods to register or delete anything.
 */
// eslint-disable-next-line @n8n/community-nodes/webhook-lifecycle-complete -- Infraspeak has no API to create, list or delete webhooks; they are set up in its UI
export class InfraspeakTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Infraspeak Trigger',
		name: 'infraspeakTrigger',
		icon: { light: 'file:infraspeak.svg', dark: 'file:infraspeak.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].length ? $parameter["events"].join(", ") : "All events"}}',
		description: 'Starts the workflow when Infraspeak sends a webhook',
		defaults: {
			name: 'Infraspeak Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{ name: 'infraspeakWebhookApi', required: false, testedBy: 'checkWebhookSecret' },
		],
		// Infraspeak sends POST or PUT, whichever the webhook is set to. An empty responseData
		// makes n8n reply {"message":"Workflow was started"}; left unset, n8n replies with
		// the literal text "firstEntryJson".
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				responseData: '',
				path: 'webhook',
			},
			{
				name: 'default',
				httpMethod: 'PUT',
				responseMode: 'onReceived',
				responseData: '',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					"Infraspeak webhooks are set up in Infraspeak, not here: copy the Production URL above into Settings → Integrations → Webhooks, pick an event, and if you set a secret there, add the same secret as this node's credential",
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: eventOptions,
				default: [],
				description:
					'Only start the workflow for these events. Leave empty for every event the Infraspeak webhook sends. Subscribing to a "State Changed" event and a specific one (e.g. Failure Closed) gives two runs for one change.',
			},
			{
				displayName: 'Simplify',
				name: 'simplify',
				type: 'boolean',
				default: true,
				description:
					"Whether to return the record's attributes flat (with ID, type, event and delivery ID) instead of the raw headers and body",
			},
		],
	};

	methods = {
		credentialTest: {
			/** There is no API to check a webhook secret against, so check what Infraspeak itself accepts. */
			async checkWebhookSecret(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const secret = String(credential.data?.secret ?? '');
				return secret.length >= 6 && secret.length <= 255
					? { status: 'OK', message: 'Secret looks valid' }
					: { status: 'Error', message: 'Infraspeak webhook secrets are 6 to 255 characters' };
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const headers = this.getHeaderData();
		const event = String(headers['x-is-topic'] ?? '');
		const deliveryId = String(headers['x-request-uuid'] ?? '');

		if (this.getNode().credentials?.infraspeakWebhookApi) {
			const { secret } = await this.getCredentials<{ secret: string }>('infraspeakWebhookApi');
			const { rawBody } = this.getRequestObject();
			if (!rawBody) {
				throw new NodeOperationError(
					this.getNode(),
					'The webhook request has no raw body to check the signature against',
				);
			}
			if (!isValidSignature(rawBody, secret, headers['x-hook-secret'])) {
				this.getResponseObject().status(401).json({ message: 'Invalid signature' });
				return { noWebhookResponse: true };
			}
		}

		const events = this.getNodeParameter('events', []) as string[];
		if (events.length > 0 && !events.includes(event)) {
			// Still a 2xx: Infraspeak switches webhooks off after repeated failures.
			return { webhookResponse: { message: 'Event ignored' } };
		}

		const body = this.getBodyData();
		const simplify = this.getNodeParameter('simplify', true) as boolean;
		const record = (body.data ?? {}) as JsonApiRecord;
		const json: IDataObject = simplify
			? ({
					id: record.id,
					type: record.type,
					...record.attributes,
					event,
					deliveryId,
				} as IDataObject)
			: { event, deliveryId, headers: headers as IDataObject, body };

		return { workflowData: [this.helpers.returnJsonArray(json)] };
	}
}
