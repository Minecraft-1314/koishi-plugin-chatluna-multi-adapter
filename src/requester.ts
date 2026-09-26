import { ChatGenerationChunk } from '@langchain/core/outputs'
import { RunnableConfig } from '@langchain/core/runnables'
import { Context, Logger } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
  EmbeddingsRequestParams,
  EmbeddingsResult,
  ModelRequestParams,
  ModelRequester,
  RerankerRequestParams,
  RerankerResult,
  RerankerUsageResult
} from 'koishi-plugin-chatluna/llm-core/platform/api'
import {
  ClientConfig,
  ClientConfigPool,
  ClientConfigWrapper
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
  ChatLunaError,
  ChatLunaErrorCode,
  isAbortError,
  isErrorWithCode
} from 'koishi-plugin-chatluna/utils/error'
import { hashString } from 'koishi-plugin-chatluna/utils/string'
import {
  completion,
  completionStream,
  createEmbeddings,
  createRequestContext,
  createRerank,
  getModels,
  responseApiCompletion,
  responseApiCompletionStream
} from '@chatluna/v1-shared-adapter'
import type { ResponseBuiltinTool, ResponseImageProvider } from '@chatluna/v1-shared-adapter'

import { PRIMARY_ENDPOINT_INDEX } from './constants'
import { RotationRegistry } from './rotation'
import { Attempt, Config, EndpointBinding } from './types'

type ChatGeneration = Awaited<ReturnType<ModelRequester['completion']>>

function isFailoverable(error: unknown): boolean {
  if (isAbortError(error)) {
    return false
  }
  return !isErrorWithCode(error, [ChatLunaErrorCode.ABORTED, ChatLunaErrorCode.NOT_AVAILABLE_CONFIG])
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toChatLunaError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }
  return new ChatLunaError(ChatLunaErrorCode.API_REQUEST_FAILED, new Error(String(error)))
}

export class EndpointRequester extends ModelRequester<ClientConfig, Config> {
  constructor(
    ctx: Context,
    pool: ClientConfigPool<ClientConfig>,
    pluginConfig: Config,
    plugin: ChatLunaPlugin<ClientConfig, Config>,
    private readonly _poolIndex: number,
    private readonly _endpointIndex: number,
    private readonly _logger: Logger
  ) {
    super(ctx, pool, pluginConfig, plugin)
  }

  get endpointIndex(): number {
    return this._endpointIndex
  }

  protected override get _config(): ClientConfigWrapper<ClientConfig> {
    const pinned = this._configPool.getConfigs()[this._poolIndex]
    if (pinned == null) {
      throw new ChatLunaError(ChatLunaErrorCode.NOT_AVAILABLE_CONFIG)
    }
    return pinned
  }

  override get logger(): Logger {
    return this._logger
  }

  override post(url: string, data: any, params?: any): Promise<any> {
    if (!this._pluginConfig.setCacheKey) {
      delete data.prompt_cache_key
    }
    return super.post(url, data, params)
  }

  async completion(params: ModelRequestParams): Promise<ChatGeneration> {
    if (!this._pluginConfig.nonStreaming && !this._pluginConfig.responseApi) {
      return super.completion(params)
    }
    const requestContext = this._requestContext()
    if (this._pluginConfig.responseApi) {
      return (await responseApiCompletion(
        requestContext,
        params,
        {
          googleSearch: this._googleSearchEnabled(params.model),
          builtinTools: this._responseBuiltinTools(params.model)
        },
        true,
        this._imageProvider()
      )) as ChatGeneration
    }
    return (await completion(
      requestContext,
      params,
      'chat/completions',
      this._googleSearchEnabled(params.model)
    )) as ChatGeneration
  }

  override async *completionStream(params: ModelRequestParams): AsyncGenerator<ChatGenerationChunk> {
    if (!this._pluginConfig.nonStreaming) {
      yield* super.completionStream(params)
      return
    }
    const generation = await this.completion(params)
    yield new ChatGenerationChunk({
      message: generation.message as any,
      text: generation.text
    })
  }

  protected async *completionStreamInternal(
    params: ModelRequestParams
  ): AsyncGenerator<ChatGenerationChunk> {
    const requestContext = this._requestContext()
    if (this._pluginConfig.responseApi) {
      yield* responseApiCompletionStream(
        requestContext,
        params,
        {
          googleSearch: this._googleSearchEnabled(params.model),
          builtinTools: this._responseBuiltinTools(params.model)
        },
        true,
        this._imageProvider()
      )
      return
    }
    yield* completionStream(
      requestContext,
      params,
      'chat/completions',
      this._googleSearchEnabled(params.model)
    )
  }

  async embeddings(params: EmbeddingsRequestParams): Promise<EmbeddingsResult> {
    return await createEmbeddings(this._requestContext(), params)
  }

  async rerank(params: RerankerRequestParams): Promise<RerankerResult[] | RerankerUsageResult> {
    return await createRerank(this._requestContext(), params)
  }

  async getModels(config?: RunnableConfig): Promise<string[]> {
    return await getModels(this._requestContext(), config)
  }

  override buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      ...Object.fromEntries(this._pluginConfig.additionHeaders),
      Authorization: `Bearer ${this._config.value.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/ChatLunaLab/chatluna',
      'X-Title': 'ChatLuna'
    }
    if (this._pluginConfig.additionCookies.length > 0) {
      headers.Cookie = this._pluginConfig.additionCookies
        .map(([key, value]) => `${key}=${value}`)
        .join('; ')
    }
    return headers
  }

  private _requestContext() {
    return createRequestContext(
      this.ctx,
      this._config.value,
      this._pluginConfig,
      this._plugin,
      this
    )
  }

  private _googleSearchEnabled(model?: string): boolean {
    return (
      this._pluginConfig.googleSearch &&
      model != null &&
      this._pluginConfig.googleSearchSupportModel.includes(model)
    )
  }

  private _responseBuiltinTools(model?: string): ResponseBuiltinTool[] {
    if (model == null || !this._pluginConfig.responseBuiltinToolSupportModel.includes(model)) {
      return []
    }
    const tools: ResponseBuiltinTool[] = []
    for (const type of this._pluginConfig.responseBuiltinTools as ResponseBuiltinTool['type'][]) {
      if (type === 'file_search') {
        if (this._pluginConfig.responseFileSearchVectorStoreIds.length > 0) {
          tools.push({ type, vector_store_ids: this._pluginConfig.responseFileSearchVectorStoreIds })
        }
        continue
      }
      if (type === 'code_interpreter') {
        tools.push({ type, container: { type: 'auto' } })
        continue
      }
      tools.push({ type })
    }
    return tools
  }

  private _imageProvider(): ResponseImageProvider {
    return async (item) => {
      const storage = (this.ctx as any).chatluna_storage
      const format =
        item.output_format === 'png' || item.output_format === 'jpeg' || item.output_format === 'webp'
          ? item.output_format
          : 'png'
      const ext = format === 'jpeg' ? 'jpg' : format
      const mime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`
      const result = item.result ?? ''
      if (!storage) {
        return `data:${mime};base64,${result}`
      }
      const file = await storage.createTempFile(
        Buffer.from(result, 'base64'),
        `${await hashString(result, 8)}.${ext}`
      )
      return file.url
    }
  }
}

export class MultiEndpointRequester extends ModelRequester<ClientConfig, Config> {
  constructor(
    ctx: Context,
    pool: ClientConfigPool<ClientConfig>,
    pluginConfig: Config,
    plugin: ChatLunaPlugin<ClientConfig, Config>,
    private readonly _endpoints: EndpointBinding[],
    private readonly _registry: RotationRegistry,
    private readonly _logger: Logger,
    private readonly _debug: boolean
  ) {
    super(ctx, pool, pluginConfig, plugin)
  }

  override get logger(): Logger {
    return this._logger
  }

  override async *completionStream(params: ModelRequestParams): AsyncGenerator<ChatGenerationChunk> {
    const requested = params.model ?? ''
    let lastError: unknown
    for (const attempt of this._registry.plan(requested)) {
      const requester = this._requesterFor(attempt)
      let started = false
      try {
        for await (const chunk of requester.completionStream(this._rewrite(params, attempt.model))) {
          started = true
          yield chunk
        }
        this._trace('ok', requested, attempt, requester)
        this._registry.reportSuccess(requested, attempt)
        return
      } catch (error) {
        lastError = error
        this._registry.reportFailure(requested, attempt)
        this._trace('fail', requested, attempt, requester, `started=${started} ${describeError(error)}`)
        if (started || !isFailoverable(error)) {
          throw error
        }
      }
    }
    throw toChatLunaError(lastError)
  }

  override async completion(params: ModelRequestParams): Promise<ChatGeneration> {
    const requested = params.model ?? ''
    let lastError: unknown
    for (const attempt of this._registry.plan(requested)) {
      const requester = this._requesterFor(attempt)
      try {
        const result = await requester.completion(this._rewrite(params, attempt.model))
        this._trace('ok', requested, attempt, requester)
        this._registry.reportSuccess(requested, attempt)
        return result
      } catch (error) {
        lastError = error
        this._registry.reportFailure(requested, attempt)
        this._trace('fail', requested, attempt, requester, describeError(error))
        if (!isFailoverable(error)) {
          throw error
        }
      }
    }
    throw toChatLunaError(lastError)
  }

  async embeddings(params: EmbeddingsRequestParams): Promise<EmbeddingsResult> {
    return await this._withFailover(params, (requester, model) => requester.embeddings({ ...params, model }))
  }

  async rerank(params: RerankerRequestParams): Promise<RerankerResult[] | RerankerUsageResult> {
    return await this._withFailover(params, (requester, model) => requester.rerank({ ...params, model }))
  }

  protected override async *completionStreamInternal(
    params: ModelRequestParams
  ): AsyncGenerator<ChatGenerationChunk> {
    yield* this.completionStream(params)
  }

  override buildHeaders(): Record<string, string> {
    return this._endpoints[0].requester.buildHeaders()
  }

  private async _withFailover<TParams extends { model?: string }, TResult>(
    params: TParams,
    invoke: (requester: EndpointRequester, model: string) => Promise<TResult>
  ): Promise<TResult> {
    const requested = params.model ?? ''
    let lastError: unknown
    for (const attempt of this._registry.plan(requested)) {
      const requester = this._requesterFor(attempt)
      try {
        const result = await invoke(requester, attempt.model)
        this._registry.reportSuccess(requested, attempt)
        return result
      } catch (error) {
        lastError = error
        this._registry.reportFailure(requested, attempt)
        if (!isFailoverable(error)) {
          throw error
        }
      }
    }
    throw toChatLunaError(lastError)
  }

  private _requesterFor(attempt: Attempt): EndpointRequester {
    const index = attempt.endpointIndex === PRIMARY_ENDPOINT_INDEX ? 0 : attempt.endpointIndex
    const found = this._endpoints.find((item) => item.index === index)
    if (found == null) {
      throw new ChatLunaError(
        ChatLunaErrorCode.NOT_AVAILABLE_CONFIG,
        new Error(`模型组中的 API 接口序号 ${attempt.endpointIndex} 不存在，请检查配置`)
      )
    }
    return found.requester
  }

  private _rewrite(params: ModelRequestParams, model: string): ModelRequestParams {
    return params.model === model ? params : { ...params, model }
  }

  private _trace(
    result: 'ok' | 'fail',
    requested: string,
    attempt: Attempt,
    requester: EndpointRequester,
    detail?: string
  ): void {
    if (!this._debug) {
      return
    }
    const line = `route ${result}: ${requested} -> ${attempt.model} @ api#${requester.endpointIndex}${
      detail == null ? '' : ` (${detail})`
    }`
    if (result === 'ok') {
      this._logger.debug(line)
    } else {
      this._logger.warn(line)
    }
  }
}
