import { Logger } from 'koishi'
import { PlatformModelEmbeddingsAndRerankerClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
  ChatLunaChatModel,
  ChatLunaEmbeddings
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import { ChatLunaReranker } from 'koishi-plugin-chatluna/llm-core/platform/rerank'
import { ModelCapabilities, ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type { ModelInfo } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChatLunaError, ChatLunaErrorCode } from 'koishi-plugin-chatluna/utils/error'
import {
  getModelMaxContextSize,
  getModelMaxContextSizeByName,
  getOpenAIFileHandlingConfig,
  isEmbeddingModel,
  isImageGenerationModel,
  isNonLLMModel,
  isRerankerModel,
  supportAudioInput,
  supportImageInput
} from '@chatluna/v1-shared-adapter'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { ModelUsageReporter } from 'koishi-plugin-chatluna/llm-core/platform/usage'

import { DEFAULT_CONTEXT_SIZE, MODEL_ENDPOINT_SEPARATOR, MODEL_LABEL_SEPARATOR } from './constants'
import { setAvailableModels } from './config'
import { MultiEndpointRequester } from './requester'
import { RotationRegistry } from './rotation'
import { AdditionalModelEntry, Attempt, Config, EndpointBinding, ModelGroupEntry } from './types'

interface DescribedModel {
  type: ModelType
  capabilities: ModelCapabilities[]
}

interface ModelEntry {
  name: string
  type: ModelType
  capabilities: ModelCapabilities[]
  maxTokens: number
}

function isBlacklisted(model: string, blacklist: string[]): boolean {
  const id = model.toLowerCase()
  return blacklist.some((keyword) => keyword.length > 0 && id.includes(keyword))
}

function detectModelType(model: string): ModelType {
  if (isRerankerModel(model)) {
    return ModelType.reranker
  }
  if (isEmbeddingModel(model)) {
    return ModelType.embeddings
  }
  return ModelType.llm
}

function describeModel(model: string): DescribedModel {
  const type = detectModelType(model)
  if (isImageGenerationModel(model)) {
    return { type, capabilities: [ModelCapabilities.ImageGeneration] }
  }
  if (type !== ModelType.llm) {
    return { type, capabilities: [] }
  }
  const capabilities = [
    ModelCapabilities.ToolCall,
    supportImageInput(model) ? ModelCapabilities.ImageInput : null,
    supportAudioInput(model) ? ModelCapabilities.AudioInput : null
  ].filter((item): item is ModelCapabilities => item != null)
  return { type, capabilities }
}

function resolveCapabilities(
  type: ModelType,
  capabilities: ModelCapabilities[]
): ModelCapabilities[] {
  return type === ModelType.llm
    ? capabilities
    : capabilities.filter((item) => item !== ModelCapabilities.ToolCall)
}

function stripEndpointPrefix(model: string): string {
  const separator = model.indexOf(MODEL_ENDPOINT_SEPARATOR)
  if (separator <= 0) {
    return model.trim()
  }
  const head = model.slice(0, separator).trim()
  return /^\d+$/.test(head) ? model.slice(separator + 1).trim() : model.trim()
}

export class MultiEndpointOpenAIClient extends PlatformModelEmbeddingsAndRerankerClient<ClientConfig> {
  platform = 'openai'

  private readonly _config: Config
  private readonly _requester: MultiEndpointRequester
  private readonly _endpoints: EndpointBinding[]
  private readonly _registry: RotationRegistry
  private readonly _logger: Logger
  private readonly _debug: boolean

  constructor(
    ctx: any,
    config: Config,
    plugin: any,
    endpoints: EndpointBinding[],
    registry: RotationRegistry,
    logger: Logger,
    debug: boolean
  ) {
    super(ctx, plugin.platformConfigPool)
    this._config = config
    this._endpoints = endpoints
    this._registry = registry
    this._logger = logger
    this._debug = debug
    this._registerGroups()
    this._requester = new MultiEndpointRequester(
      ctx,
      plugin.platformConfigPool,
      config,
      plugin,
      endpoints,
      registry,
      logger,
      debug
    )
  }

  override async refreshModels(_config?: RunnableConfig): Promise<ModelInfo[]> {
    try {
      const { collected, index } = await this._pullAllEndpoints()
      const labels = this._buildModelLabels(collected, index)
      setAvailableModels(labels.map((item) => item.label))
      this._registry.setModelEndpoints(index)
      this._registry.setModelLabels(new Map(labels.map((item) => [item.label, item.target])))
      this._registerGroups()
      const models = this._buildModelList(collected)
      this._logSummary(models, index)
      return models as ModelInfo[]
    } catch (e) {
      if (e instanceof ChatLunaError) {
        throw e
      }
      throw new ChatLunaError(ChatLunaErrorCode.MODEL_INIT_ERROR, e as Error)
    }
  }

  private _buildModelLabels(
    collected: Map<string, DescribedModel>,
    index: Map<string, number[]>
  ): { label: string; target: Attempt }[] {
    const pairs: { endpointIndex: number; model: string }[] = []
    for (const endpoint of this._endpoints) {
      for (const [model, info] of collected) {
        if (info.type !== ModelType.llm) {
          continue
        }
        if (info.capabilities.includes(ModelCapabilities.ImageGeneration)) {
          continue
        }
        if (index.get(model)?.includes(endpoint.index)) {
          pairs.push({ endpointIndex: endpoint.index, model })
        }
      }
    }
    const totals = new Map<string, number>()
    for (const pair of pairs) {
      const key = this._pairKey(pair)
      totals.set(key, (totals.get(key) ?? 0) + 1)
    }
    const seen = new Map<string, number>()
    return pairs.map((pair) => {
      const key = this._pairKey(pair)
      const ordinal = (seen.get(key) ?? 0) + 1
      seen.set(key, ordinal)
      const endpoint = this._endpoints.find((item) => item.index === pair.endpointIndex)
      const base = endpoint?.apiEndpoint ?? `#${pair.endpointIndex}`
      const shown = (totals.get(key) ?? 1) > 1 ? `${base}-${ordinal}` : base
      return {
        label: `${shown}${MODEL_LABEL_SEPARATOR}${pair.model}`,
        target: { key: '', endpointIndex: pair.endpointIndex, model: pair.model }
      }
    })
  }

  private _pairKey(pair: { endpointIndex: number; model: string }): string {
    const endpoint = this._endpoints.find((item) => item.index === pair.endpointIndex)
    return `${endpoint?.apiEndpoint ?? pair.endpointIndex}\u0000${pair.model}`
  }

  private _pulledEntry(name: string, collected: Map<string, DescribedModel>): ModelEntry | undefined {
    const info = collected.get(name)
    if (info == null) {
      return undefined
    }
    return { name, ...info, maxTokens: getModelMaxContextSizeByName(name) }
  }

  private _registerGroups(): void {
    this._registry.setGroups(
      this._enabledGroups().map((group) => ({
        name: group.name,
        models: [
          ...(group.availableModels ?? []),
          ...(group.models ?? []).map((entry) => entry.model)
        ],
        strategy: group.strategy
      }))
    )
  }

  private _enabledGroups(): ModelGroupEntry[] {
    return this._config.modelGroups.filter((group) => group.enabled !== false)
  }

  protected _createModel(model: string, report: ModelUsageReporter) {
    const info = this._modelInfos[model]
    if (info == null) {
      this._logger.warn(`Model ${model} not found`)
      throw new ChatLunaError(
        ChatLunaErrorCode.MODEL_NOT_FOUND,
        new Error(
          `The model ${model} is not found in the models: ${JSON.stringify(Object.keys(this._modelInfos))}`
        )
      )
    }
    if (info.type === ModelType.llm) {
      const resolved = this._registry.resolvePrimaryModel(model) ?? model
      const modelMaxContextSize = getModelMaxContextSize(info)
      return new ChatLunaChatModel({
        usageReporter: report,
        modelInfo: info,
        requester: this._requester as any,
        model,
        maxTokenLimit: Math.floor(
          (info.maxTokens || modelMaxContextSize || DEFAULT_CONTEXT_SIZE) * this._config.maxContextRatio
        ),
        modelMaxContextSize,
        frequencyPenalty: this._config.frequencyPenalty,
        presencePenalty: this._config.presencePenalty,
        timeout: this._config.timeout,
        temperature: this._config.temperature,
        maxRetries: this._config.maxRetries,
        llmType: 'openai',
        fileHandlingConfig: getOpenAIFileHandlingConfig(resolved),
        isThinkModel: /reasoner|r1|thinking/i.test(resolved)
      })
    }
    if (info.type === ModelType.reranker) {
      return new ChatLunaReranker({
        usageReporter: report,
        client: this._requester as any,
        model,
        maxRetries: this._config.maxRetries,
        timeout: this._config.timeout
      })
    }
    return new ChatLunaEmbeddings({
      usageReporter: report,
      client: this._requester as any,
      model,
      maxRetries: this._config.maxRetries
    })
  }

  private async _pullAllEndpoints(): Promise<{
    collected: Map<string, DescribedModel>
    index: Map<string, number[]>
  }> {
    const collected = new Map<string, DescribedModel>()
    const index = new Map<string, number[]>()
    if (!this._config.pullModels || this._endpoints.length === 0) {
      return { collected, index }
    }
    const results = await Promise.allSettled(
      this._endpoints.map(async (endpoint) => ({
        index: endpoint.index,
        models: await endpoint.requester.getModels()
      }))
    )
    const failures: string[] = []
    let succeeded = 0
    results.forEach((result, position) => {
      const endpoint = this._endpoints[position]
      if (result.status === 'rejected') {
        const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
        failures.push(`api#${endpoint.index} (${endpoint.apiEndpoint}): ${reason}`)
        this._logger.warn(`Failed to pull models from api#${endpoint.index} ${endpoint.apiEndpoint}: ${reason}`)
        return
      }
      succeeded += 1
      for (const model of result.value.models) {
        if (isBlacklisted(model, this._config.blacklistModels)) {
          continue
        }
        if (isNonLLMModel(model) && !isImageGenerationModel(model)) {
          continue
        }
        if (!collected.has(model)) {
          collected.set(model, describeModel(model))
        }
        const owners = index.get(model)
        if (owners == null) {
          index.set(model, [result.value.index])
        } else if (!owners.includes(result.value.index)) {
          owners.push(result.value.index)
        }
      }
    })
    if (succeeded === 0) {
      throw new ChatLunaError(
        ChatLunaErrorCode.MODEL_INIT_ERROR,
        new Error(`所有 API 接口均拉取模型列表失败 -> ${failures.join(' | ')}`)
      )
    }
    if (failures.length > 0) {
      this._logger.warn(
        `Loaded models from ${succeeded}/${this._endpoints.length} endpoints; failed: ${failures.join(' | ')}`
      )
    }
    return { collected, index }
  }

  private _additionalModels(): ModelEntry[] {
    const list: ModelEntry[] = []
    for (const entry of this._config.additionalModels) {
      const model = entry.model?.trim()
      if (!model) {
        continue
      }
      list.push({
        name: model,
        type: entry.modelType,
        capabilities: resolveCapabilities(entry.modelType, entry.modelCapabilities),
        maxTokens: entry.contextSize
      })
    }
    return list
  }

  private _buildModelList(collected: Map<string, DescribedModel>): ModelEntry[] {
    const groups = this._buildGroupModels(collected)
    const mode = this._config.modelListMode ?? 'both'
    if (mode === 'groupsOnly') {
      return groups
    }
    const models = new Map<string, ModelEntry>()
    for (const [name, described] of collected) {
      models.set(name, { name, ...described, maxTokens: getModelMaxContextSizeByName(name) })
    }
    for (const item of this._additionalModels()) {
      models.set(item.name, item)
    }
    const base = [...models.values()]
    return mode === 'modelsOnly' ? base : [...base, ...groups]
  }

  private _buildGroupModels(collected: Map<string, DescribedModel>): ModelEntry[] {
    const result: ModelEntry[] = []
    const used = new Set<string>()
    for (const group of this._enabledGroups()) {
      const name = group.name?.trim()
      if (!name || used.has(name) || !this._registry.hasGroup(name)) {
        continue
      }
      const manual = new Map<string, AdditionalModelEntry>()
      for (const row of group.models ?? []) {
        manual.set(stripEndpointPrefix(row.model), row)
      }
      const runtime = this._registry.getGroup(name)
      const candidates = (runtime?.attempts ?? []).map((attempt) =>
        this._describeCandidate(attempt.model, collected, manual)
      )
      if (candidates.length === 0) {
        continue
      }
      used.add(name)
      const capabilities = candidates
        .map((item) => item.capabilities)
        .reduce((accumulator, current) => accumulator.filter((item) => current.includes(item)))
      result.push({
        name,
        type: candidates[0].type,
        capabilities: capabilities.length > 0 ? capabilities : [ModelCapabilities.TextInput],
        maxTokens: Math.min(...candidates.map((item) => item.maxTokens))
      })
    }
    return result
  }

  private _describeCandidate(
    model: string,
    collected: Map<string, DescribedModel>,
    manual: Map<string, AdditionalModelEntry>
  ): ModelEntry {
    const row = manual.get(model)
    if (row == null) {
      const known = this._pulledEntry(model, collected)
      if (known != null) {
        return known
      }
    }
    const type = row?.modelType ?? ModelType.llm
    return {
      name: model,
      type,
      capabilities: resolveCapabilities(
        type,
        row?.modelCapabilities ?? [ModelCapabilities.TextInput, ModelCapabilities.ToolCall]
      ),
      maxTokens: row?.contextSize ?? DEFAULT_CONTEXT_SIZE
    }
  }

  private _logSummary(models: ModelEntry[], index: Map<string, number[]>): void {
    const summary =
      `loaded ${models.length} models from ${this._endpoints.length} endpoints ` +
      `(mode=${this._config.modelListMode}), ${this._config.modelGroups.length} model groups configured`
    if (!this._debug) {
      this._logger.info(summary)
      return
    }
    const perEndpoint = this._endpoints.map((endpoint) => {
      const count = [...index.values()].filter((owners) => owners.includes(endpoint.index)).length
      return `api#${endpoint.index}(${endpoint.apiEndpoint})=${count}`
    })
    this._logger.debug(`${summary}; ${perEndpoint.join(', ')}`)
    for (const group of this._registry.listGroups()) {
      this._logger.debug(
        `group %s [%s] -> %s`,
        group.name,
        group.strategy,
        group.attempts.map((attempt) => `${attempt.model}@api#${attempt.endpointIndex}`).join(' -> ')
      )
    }
  }
}
