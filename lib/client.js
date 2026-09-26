"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiEndpointOpenAIClient = void 0;
const client_1 = require("koishi-plugin-chatluna/llm-core/platform/client");
const model_1 = require("koishi-plugin-chatluna/llm-core/platform/model");
const rerank_1 = require("koishi-plugin-chatluna/llm-core/platform/rerank");
const types_1 = require("koishi-plugin-chatluna/llm-core/platform/types");
const error_1 = require("koishi-plugin-chatluna/utils/error");
const v1_shared_adapter_1 = require("@chatluna/v1-shared-adapter");
const constants_1 = require("./constants");
const config_1 = require("./config");
const requester_1 = require("./requester");
function isBlacklisted(model, blacklist) {
    const id = model.toLowerCase();
    return blacklist.some((keyword) => keyword.length > 0 && id.includes(keyword));
}
function detectModelType(model) {
    if ((0, v1_shared_adapter_1.isRerankerModel)(model)) {
        return types_1.ModelType.reranker;
    }
    if ((0, v1_shared_adapter_1.isEmbeddingModel)(model)) {
        return types_1.ModelType.embeddings;
    }
    return types_1.ModelType.llm;
}
function describeModel(model) {
    const type = detectModelType(model);
    if ((0, v1_shared_adapter_1.isImageGenerationModel)(model)) {
        return { type, capabilities: [types_1.ModelCapabilities.ImageGeneration] };
    }
    if (type !== types_1.ModelType.llm) {
        return { type, capabilities: [] };
    }
    const capabilities = [
        types_1.ModelCapabilities.ToolCall,
        (0, v1_shared_adapter_1.supportImageInput)(model) ? types_1.ModelCapabilities.ImageInput : null,
        (0, v1_shared_adapter_1.supportAudioInput)(model) ? types_1.ModelCapabilities.AudioInput : null
    ].filter((item) => item != null);
    return { type, capabilities };
}
function resolveCapabilities(type, capabilities) {
    return type === types_1.ModelType.llm
        ? capabilities
        : capabilities.filter((item) => item !== types_1.ModelCapabilities.ToolCall);
}
function stripEndpointPrefix(model) {
    const separator = model.indexOf(constants_1.MODEL_ENDPOINT_SEPARATOR);
    if (separator <= 0) {
        return model.trim();
    }
    const head = model.slice(0, separator).trim();
    return /^\d+$/.test(head) ? model.slice(separator + 1).trim() : model.trim();
}
class MultiEndpointOpenAIClient extends client_1.PlatformModelEmbeddingsAndRerankerClient {
    constructor(ctx, config, plugin, endpoints, registry, logger, debug) {
        super(ctx, plugin.platformConfigPool);
        this.platform = 'openai';
        this._config = config;
        this._endpoints = endpoints;
        this._registry = registry;
        this._logger = logger;
        this._debug = debug;
        this._registerGroups();
        this._requester = new requester_1.MultiEndpointRequester(ctx, plugin.platformConfigPool, config, plugin, endpoints, registry, logger, debug);
    }
    async refreshModels(_config) {
        try {
            const { collected, index } = await this._pullAllEndpoints();
            const labels = this._buildModelLabels(collected, index);
            (0, config_1.setAvailableModels)(labels.map((item) => item.label));
            this._registry.setModelEndpoints(index);
            this._registry.setModelLabels(new Map(labels.map((item) => [item.label, item.target])));
            this._registerGroups();
            const models = this._buildModelList(collected);
            this._logSummary(models, index);
            return models;
        }
        catch (e) {
            if (e instanceof error_1.ChatLunaError) {
                throw e;
            }
            throw new error_1.ChatLunaError(error_1.ChatLunaErrorCode.MODEL_INIT_ERROR, e);
        }
    }
    _buildModelLabels(collected, index) {
        const pairs = [];
        for (const endpoint of this._endpoints) {
            for (const [model, info] of collected) {
                if (info.type !== types_1.ModelType.llm) {
                    continue;
                }
                if (info.capabilities.includes(types_1.ModelCapabilities.ImageGeneration)) {
                    continue;
                }
                if (index.get(model)?.includes(endpoint.index)) {
                    pairs.push({ endpointIndex: endpoint.index, model });
                }
            }
        }
        const totals = new Map();
        for (const pair of pairs) {
            const key = this._pairKey(pair);
            totals.set(key, (totals.get(key) ?? 0) + 1);
        }
        const seen = new Map();
        return pairs.map((pair) => {
            const key = this._pairKey(pair);
            const ordinal = (seen.get(key) ?? 0) + 1;
            seen.set(key, ordinal);
            const endpoint = this._endpoints.find((item) => item.index === pair.endpointIndex);
            const base = endpoint?.apiEndpoint ?? `#${pair.endpointIndex}`;
            const shown = (totals.get(key) ?? 1) > 1 ? `${base}-${ordinal}` : base;
            return {
                label: `${shown}${constants_1.MODEL_LABEL_SEPARATOR}${pair.model}`,
                target: { key: '', endpointIndex: pair.endpointIndex, model: pair.model }
            };
        });
    }
    _pairKey(pair) {
        const endpoint = this._endpoints.find((item) => item.index === pair.endpointIndex);
        return `${endpoint?.apiEndpoint ?? pair.endpointIndex}\u0000${pair.model}`;
    }
    _pulledEntry(name, collected) {
        const info = collected.get(name);
        if (info == null) {
            return undefined;
        }
        return { name, ...info, maxTokens: (0, v1_shared_adapter_1.getModelMaxContextSizeByName)(name) };
    }
    _registerGroups() {
        this._registry.setGroups(this._enabledGroups().map((group) => ({
            name: group.name,
            models: [
                ...(group.availableModels ?? []),
                ...(group.models ?? []).map((entry) => entry.model)
            ],
            strategy: group.strategy
        })));
    }
    _enabledGroups() {
        return this._config.modelGroups.filter((group) => group.enabled !== false);
    }
    _createModel(model, report) {
        const info = this._modelInfos[model];
        if (info == null) {
            this._logger.warn(`Model ${model} not found`);
            throw new error_1.ChatLunaError(error_1.ChatLunaErrorCode.MODEL_NOT_FOUND, new Error(`The model ${model} is not found in the models: ${JSON.stringify(Object.keys(this._modelInfos))}`));
        }
        if (info.type === types_1.ModelType.llm) {
            const resolved = this._registry.resolvePrimaryModel(model) ?? model;
            const modelMaxContextSize = (0, v1_shared_adapter_1.getModelMaxContextSize)(info);
            return new model_1.ChatLunaChatModel({
                usageReporter: report,
                modelInfo: info,
                requester: this._requester,
                model,
                maxTokenLimit: Math.floor((info.maxTokens || modelMaxContextSize || constants_1.DEFAULT_CONTEXT_SIZE) * this._config.maxContextRatio),
                modelMaxContextSize,
                frequencyPenalty: this._config.frequencyPenalty,
                presencePenalty: this._config.presencePenalty,
                timeout: this._config.timeout,
                temperature: this._config.temperature,
                maxRetries: this._config.maxRetries,
                llmType: 'openai',
                fileHandlingConfig: (0, v1_shared_adapter_1.getOpenAIFileHandlingConfig)(resolved),
                isThinkModel: /reasoner|r1|thinking/i.test(resolved)
            });
        }
        if (info.type === types_1.ModelType.reranker) {
            return new rerank_1.ChatLunaReranker({
                usageReporter: report,
                client: this._requester,
                model,
                maxRetries: this._config.maxRetries,
                timeout: this._config.timeout
            });
        }
        return new model_1.ChatLunaEmbeddings({
            usageReporter: report,
            client: this._requester,
            model,
            maxRetries: this._config.maxRetries
        });
    }
    async _pullAllEndpoints() {
        const collected = new Map();
        const index = new Map();
        if (!this._config.pullModels || this._endpoints.length === 0) {
            return { collected, index };
        }
        const results = await Promise.allSettled(this._endpoints.map(async (endpoint) => ({
            index: endpoint.index,
            models: await endpoint.requester.getModels()
        })));
        const failures = [];
        let succeeded = 0;
        results.forEach((result, position) => {
            const endpoint = this._endpoints[position];
            if (result.status === 'rejected') {
                const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
                failures.push(`api#${endpoint.index} (${endpoint.apiEndpoint}): ${reason}`);
                this._logger.warn(`Failed to pull models from api#${endpoint.index} ${endpoint.apiEndpoint}: ${reason}`);
                return;
            }
            succeeded += 1;
            for (const model of result.value.models) {
                if (isBlacklisted(model, this._config.blacklistModels)) {
                    continue;
                }
                if ((0, v1_shared_adapter_1.isNonLLMModel)(model) && !(0, v1_shared_adapter_1.isImageGenerationModel)(model)) {
                    continue;
                }
                if (!collected.has(model)) {
                    collected.set(model, describeModel(model));
                }
                const owners = index.get(model);
                if (owners == null) {
                    index.set(model, [result.value.index]);
                }
                else if (!owners.includes(result.value.index)) {
                    owners.push(result.value.index);
                }
            }
        });
        if (succeeded === 0) {
            throw new error_1.ChatLunaError(error_1.ChatLunaErrorCode.MODEL_INIT_ERROR, new Error(`所有 API 接口均拉取模型列表失败 -> ${failures.join(' | ')}`));
        }
        if (failures.length > 0) {
            this._logger.warn(`Loaded models from ${succeeded}/${this._endpoints.length} endpoints; failed: ${failures.join(' | ')}`);
        }
        return { collected, index };
    }
    _additionalModels() {
        const list = [];
        for (const entry of this._config.additionalModels) {
            const model = entry.model?.trim();
            if (!model) {
                continue;
            }
            list.push({
                name: model,
                type: entry.modelType,
                capabilities: resolveCapabilities(entry.modelType, entry.modelCapabilities),
                maxTokens: entry.contextSize
            });
        }
        return list;
    }
    _buildModelList(collected) {
        const groups = this._buildGroupModels(collected);
        const mode = this._config.modelListMode ?? 'both';
        if (mode === 'groupsOnly') {
            return groups;
        }
        const models = new Map();
        for (const [name, described] of collected) {
            models.set(name, { name, ...described, maxTokens: (0, v1_shared_adapter_1.getModelMaxContextSizeByName)(name) });
        }
        for (const item of this._additionalModels()) {
            models.set(item.name, item);
        }
        const base = [...models.values()];
        return mode === 'modelsOnly' ? base : [...base, ...groups];
    }
    _buildGroupModels(collected) {
        const result = [];
        const used = new Set();
        for (const group of this._enabledGroups()) {
            const name = group.name?.trim();
            if (!name || used.has(name) || !this._registry.hasGroup(name)) {
                continue;
            }
            const manual = new Map();
            for (const row of group.models ?? []) {
                manual.set(stripEndpointPrefix(row.model), row);
            }
            const runtime = this._registry.getGroup(name);
            const candidates = (runtime?.attempts ?? []).map((attempt) => this._describeCandidate(attempt.model, collected, manual));
            if (candidates.length === 0) {
                continue;
            }
            used.add(name);
            const capabilities = candidates
                .map((item) => item.capabilities)
                .reduce((accumulator, current) => accumulator.filter((item) => current.includes(item)));
            result.push({
                name,
                type: candidates[0].type,
                capabilities: capabilities.length > 0 ? capabilities : [types_1.ModelCapabilities.TextInput],
                maxTokens: Math.min(...candidates.map((item) => item.maxTokens))
            });
        }
        return result;
    }
    _describeCandidate(model, collected, manual) {
        const row = manual.get(model);
        if (row == null) {
            const known = this._pulledEntry(model, collected);
            if (known != null) {
                return known;
            }
        }
        const type = row?.modelType ?? types_1.ModelType.llm;
        return {
            name: model,
            type,
            capabilities: resolveCapabilities(type, row?.modelCapabilities ?? [types_1.ModelCapabilities.TextInput, types_1.ModelCapabilities.ToolCall]),
            maxTokens: row?.contextSize ?? constants_1.DEFAULT_CONTEXT_SIZE
        };
    }
    _logSummary(models, index) {
        const summary = `loaded ${models.length} models from ${this._endpoints.length} endpoints ` +
            `(mode=${this._config.modelListMode}), ${this._config.modelGroups.length} model groups configured`;
        if (!this._debug) {
            this._logger.info(summary);
            return;
        }
        const perEndpoint = this._endpoints.map((endpoint) => {
            const count = [...index.values()].filter((owners) => owners.includes(endpoint.index)).length;
            return `api#${endpoint.index}(${endpoint.apiEndpoint})=${count}`;
        });
        this._logger.debug(`${summary}; ${perEndpoint.join(', ')}`);
        for (const group of this._registry.listGroups()) {
            this._logger.debug(`group %s [%s] -> %s`, group.name, group.strategy, group.attempts.map((attempt) => `${attempt.model}@api#${attempt.endpointIndex}`).join(' -> '));
        }
    }
}
exports.MultiEndpointOpenAIClient = MultiEndpointOpenAIClient;
