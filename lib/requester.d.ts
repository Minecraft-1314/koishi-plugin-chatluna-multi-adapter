import { ChatGenerationChunk } from '@langchain/core/outputs';
import { RunnableConfig } from '@langchain/core/runnables';
import { Context, Logger } from 'koishi';
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat';
import { EmbeddingsRequestParams, EmbeddingsResult, ModelRequestParams, ModelRequester, RerankerRequestParams, RerankerResult, RerankerUsageResult } from 'koishi-plugin-chatluna/llm-core/platform/api';
import { ClientConfig, ClientConfigPool, ClientConfigWrapper } from 'koishi-plugin-chatluna/llm-core/platform/config';
import { RotationRegistry } from './rotation';
import { Config, EndpointBinding } from './types';
type ChatGeneration = Awaited<ReturnType<ModelRequester['completion']>>;
export declare class EndpointRequester extends ModelRequester<ClientConfig, Config> {
    private readonly _poolIndex;
    private readonly _endpointIndex;
    private readonly _logger;
    constructor(ctx: Context, pool: ClientConfigPool<ClientConfig>, pluginConfig: Config, plugin: ChatLunaPlugin<ClientConfig, Config>, _poolIndex: number, _endpointIndex: number, _logger: Logger);
    get endpointIndex(): number;
    protected get _config(): ClientConfigWrapper<ClientConfig>;
    get logger(): Logger;
    post(url: string, data: any, params?: any): Promise<any>;
    completion(params: ModelRequestParams): Promise<ChatGeneration>;
    completionStream(params: ModelRequestParams): AsyncGenerator<ChatGenerationChunk>;
    protected completionStreamInternal(params: ModelRequestParams): AsyncGenerator<ChatGenerationChunk>;
    embeddings(params: EmbeddingsRequestParams): Promise<EmbeddingsResult>;
    rerank(params: RerankerRequestParams): Promise<RerankerResult[] | RerankerUsageResult>;
    getModels(config?: RunnableConfig): Promise<string[]>;
    buildHeaders(): Record<string, string>;
    private _requestContext;
    private _googleSearchEnabled;
    private _responseBuiltinTools;
    private _imageProvider;
}
export declare class MultiEndpointRequester extends ModelRequester<ClientConfig, Config> {
    private readonly _endpoints;
    private readonly _registry;
    private readonly _logger;
    private readonly _debug;
    constructor(ctx: Context, pool: ClientConfigPool<ClientConfig>, pluginConfig: Config, plugin: ChatLunaPlugin<ClientConfig, Config>, _endpoints: EndpointBinding[], _registry: RotationRegistry, _logger: Logger, _debug: boolean);
    get logger(): Logger;
    completionStream(params: ModelRequestParams): AsyncGenerator<ChatGenerationChunk>;
    completion(params: ModelRequestParams): Promise<ChatGeneration>;
    embeddings(params: EmbeddingsRequestParams): Promise<EmbeddingsResult>;
    rerank(params: RerankerRequestParams): Promise<RerankerResult[] | RerankerUsageResult>;
    protected completionStreamInternal(params: ModelRequestParams): AsyncGenerator<ChatGenerationChunk>;
    buildHeaders(): Record<string, string>;
    private _withFailover;
    private _requesterFor;
    private _rewrite;
    private _trace;
}
export {};
