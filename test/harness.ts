/**
 * Runs the Infraspeak node through n8n's real execution engine (n8n-core
 * WorkflowExecute → RoutingNode), the same code path n8n uses at runtime.
 * Only two things are stubbed: credential storage (returns a fixed token,
 * applied via the real credential's `authenticate` definition) and HTTP
 * (intercepted with nock by the caller).
 */
import { ExecutionLifecycleHooks, WorkflowExecute } from 'n8n-core';
import nock from 'nock';
import {
	Workflow,
	type ICredentialDataDecryptedObject,
	type IDataObject,
	type IHttpRequestOptions,
	type INode,
	type INodeExecutionData,
	type INodeParameters,
	type INodeTypes,
	type IRun,
	type IWorkflowExecuteAdditionalData,
} from 'n8n-workflow';
import { InfraspeakApi } from '../credentials/InfraspeakApi.credentials';
import { Infraspeak } from '../nodes/Infraspeak/Infraspeak.node';

export const TEST_TOKEN = 'test-token';
export const BASE_URL = 'https://api.infraspeak.com';

const nodeType = new Infraspeak();
const credentialType = new InfraspeakApi();

const nodeTypes: INodeTypes = {
	getByName: () => nodeType,
	getByNameAndVersion: () => nodeType,
	getKnownTypes: () => ({}),
};

/** Applies the credential's generic `authenticate.properties.headers` the way n8n does. */
function applyGenericAuth(
	credentials: ICredentialDataDecryptedObject,
	requestOptions: IHttpRequestOptions,
): IHttpRequestOptions {
	const auth = credentialType.authenticate;
	const headers: IDataObject = { ...(requestOptions.headers as IDataObject) };
	for (const [name, template] of Object.entries(auth.properties.headers ?? {})) {
		headers[name] = String(template)
			.replace(/^=/, '')
			.replace(/\{\{\s*\$credentials\.(\w+)\s*\}\}/g, (_, key: string) =>
				String(credentials[key] ?? ''),
			);
	}
	return { ...requestOptions, headers };
}

function buildAdditionalData(hooks: ExecutionLifecycleHooks): IWorkflowExecuteAdditionalData {
	const credentialsHelper = {
		getParentTypes: () => [],
		isCredentialUsableByNode: () => true,
		runPreAuthentication: async () => undefined,
		getDecrypted: async () => ({ accessToken: TEST_TOKEN }),
		getCredentials: async () => ({ getData: () => ({ accessToken: TEST_TOKEN }) }),
		getCredentialsProperties: () => credentialType.properties,
		authenticate: async (
			credentials: ICredentialDataDecryptedObject,
			_type: string,
			requestOptions: IHttpRequestOptions,
		) => applyGenericAuth(credentials, requestOptions),
		preAuthentication: async () => undefined,
		updateCredentials: async () => undefined,
		updateCredentialsOauthTokenData: async () => undefined,
	};

	return {
		credentialsHelper,
		hooks,
		executionId: 'test-execution',
		currentNodeExecutionIndex: 0,
		restApiUrl: 'http://localhost:5678/rest',
		instanceBaseUrl: 'http://localhost:5678',
		formWaitingBaseUrl: 'http://localhost:5678/form-waiting',
		webhookBaseUrl: 'http://localhost:5678/webhook',
		webhookWaitingBaseUrl: 'http://localhost:5678/webhook-waiting',
		webhookTestBaseUrl: 'http://localhost:5678/webhook-test',
		variables: {},
		userId: 'test-user',
		executeWorkflow: async () => {
			throw new Error('not supported in tests');
		},
		getRunExecutionData: async () => undefined,
		logAiEvent: async () => undefined,
		startRunnerTask: async () => {
			throw new Error('not supported in tests');
		},
	} as unknown as IWorkflowExecuteAdditionalData;
}

export interface NodeRunResult {
	items: INodeExecutionData[];
	error?: Error;
}

/** Executes the Infraspeak node once with the given parameters. */
export async function runNode(parameters: INodeParameters): Promise<NodeRunResult> {
	const node: INode = {
		id: 'infraspeak-node',
		name: 'Infraspeak',
		type: 'n8n-nodes-infraspeak.infraspeak',
		typeVersion: 1,
		position: [0, 0],
		parameters,
		credentials: { infraspeakApi: { id: 'cred-1', name: 'Infraspeak' } },
	};

	const workflow = new Workflow({
		id: 'test-workflow',
		name: 'test',
		nodes: [node],
		connections: {},
		active: false,
		nodeTypes,
	});

	const hooks = new ExecutionLifecycleHooks('manual', 'test-execution', {
		id: 'test-workflow',
		name: 'test',
		active: false,
		isArchived: false,
		nodes: [node],
		connections: {},
		createdAt: new Date(),
		updatedAt: new Date(),
	} as never);

	const execute = new WorkflowExecute(buildAdditionalData(hooks), 'manual');
	const run: IRun = await execute.run({ workflow, startNode: node });

	const taskData = run.data.resultData.runData[node.name]?.[0];
	const error = run.data.resultData.error ?? taskData?.error;
	return {
		items: taskData?.data?.main?.[0] ?? [],
		error: error ? (error as Error) : undefined,
	};
}

/**
 * Installs nock for one test file and fully removes it afterwards.
 *
 * Jest gives each test file its own nock instance, but they all patch the same
 * Node `http` module. Without `restore()`, a finished file's nock stays installed
 * with net connect disabled and blocks the next file's requests in the same worker.
 */
export function useNock(options: { assertAllUsed?: boolean } = {}): void {
	beforeAll(() => {
		if (!nock.isActive()) nock.activate();
		nock.disableNetConnect();
	});
	afterEach(() => {
		// Check before cleaning, in one hook, so ordering between hooks can't matter.
		const pending = nock.pendingMocks();
		nock.cleanAll();
		if (options.assertAllUsed) expect(pending).toEqual([]);
	});
	afterAll(() => {
		nock.cleanAll();
		nock.enableNetConnect();
		nock.restore();
	});
}
