"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MultiEndpointRequester = exports.EndpointRequester = void 0;
const outputs_1 = require("@langchain/core/outputs");
const api_1 = require("koishi-plugin-chatluna/llm-core/platform/api");
const error_1 = require("koishi-plugin-chatluna/utils/error");
const string_1 = require("koishi-plugin-chatluna/utils/string");
const v1_shared_adapter_1 = require("@chatluna/v1-shared-adapter");
const constants_1 = require("./constants");
function isFailoverable(error) {
    if ((0, error_1.isAbortError)(error)) {
        return false;
    }
    return !(0, error_1.isErrorWithCode)(error, [error_1.ChatLunaErrorCode.ABORTED, error_1.ChatLunaErrorCode.NOT_AVAILABLE_CONFIG]);
}
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
function toChatLunaError(error) {
    if (error instanceof Error) {
        return error;
    }
    return new error_1.ChatLunaError(error_1.ChatLunaErrorCode.API_REQUEST_FAILED, new Error(String(error)));
}
class EndpointRequester extends api_1.ModelRequester {
    constructor(ctx, pool, pluginConfig, plugin, _poolIndex, _endpointIndex, _logger) {
        super(ctx, pool, pluginConfig, plugin);
        this._poolIndex = _poolIndex;
        this._endpointIndex = _endpointIndex;
        this._logger = _logger;
    }
    get endpointIndex() {
        return this._endpointIndex;
    }
    get _config() {
        const pinned = this._configPool.getConfigs()[this._poolIndex];
        if (pinned == null) {
            throw new error_1.ChatLunaError(error_1.ChatLunaErrorCode.NOT_AVAILABLE_CONFIG);
        }
        return pinned;
    }
    get logger() {
        return this._logger;
    }
    post(url, data, params) {
        if (!this._pluginConfig.setCacheKey) {
            delete data.prompt_cache_key;
        }
        return super.post(url, data, params);
    }
    async completion(params) {
        if (!this._pluginConfig.nonStreaming && !this._pluginConfig.responseApi) {
            return super.completion(params);
        }
        const requestContext = this._requestContext();
        if (this._pluginConfig.responseApi) {
            return (await (0, v1_shared_adapter_1.responseApiCompletion)(requestContext, params, {
                googleSearch: this._googleSearchEnabled(params.model),
                builtinTools: this._responseBuiltinTools(params.model)
            }, true, this._imageProvider()));
        }
        return (await (0, v1_shared_adapter_1.completion)(requestContext, params, 'chat/completions', this._googleSearchEnabled(params.model)));
    }
    async *completionStream(params) {
        if (!this._pluginConfig.nonStreaming) {
            yield* super.completionStream(params);
            return;
        }
        const generation = await this.completion(params);
        yield new outputs_1.ChatGenerationChunk({
            message: generation.message,
            text: generation.text
        });
    }
    async *completionStreamInternal(params) {
        const requestContext = this._requestContext();
        if (this._pluginConfig.responseApi) {
            yield* (0, v1_shared_adapter_1.responseApiCompletionStream)(requestContext, params, {
                googleSearch: this._googleSearchEnabled(params.model),
                builtinTools: this._responseBuiltinTools(params.model)
            }, true, this._imageProvider());
            return;
        }
        yield* (0, v1_shared_adapter_1.completionStream)(requestContext, params, 'chat/completions', this._googleSearchEnabled(params.model));
    }
    async embeddings(params) {
        return await (0, v1_shared_adapter_1.createEmbeddings)(this._requestContext(), params);
    }
    async rerank(params) {
        return await (0, v1_shared_adapter_1.createRerank)(this._requestContext(), params);
    }
    async getModels(config) {
        return await (0, v1_shared_adapter_1.getModels)(this._requestContext(), config);
    }
    buildHeaders() {
        const headers = {
            ...Object.fromEntries(this._pluginConfig.additionHeaders),
            Authorization: `Bearer ${this._config.value.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/ChatLunaLab/chatluna',
            'X-Title': 'ChatLuna'
        };
        if (this._pluginConfig.additionCookies.length > 0) {
            headers.Cookie = this._pluginConfig.additionCookies
                .map(([key, value]) => `${key}=${value}`)
                .join('; ');
        }
        return headers;
    }
    _requestContext() {
        return (0, v1_shared_adapter_1.createRequestContext)(this.ctx, this._config.value, this._pluginConfig, this._plugin, this);
    }
    _googleSearchEnabled(model) {
        return (this._pluginConfig.googleSearch &&
            model != null &&
            this._pluginConfig.googleSearchSupportModel.includes(model));
    }
    _responseBuiltinTools(model) {
        if (model == null || !this._pluginConfig.responseBuiltinToolSupportModel.includes(model)) {
            return [];
        }
        const tools = [];
        for (const type of this._pluginConfig.responseBuiltinTools) {
            if (type === 'file_search') {
                if (this._pluginConfig.responseFileSearchVectorStoreIds.length > 0) {
                    tools.push({ type, vector_store_ids: this._pluginConfig.responseFileSearchVectorStoreIds });
                }
                continue;
            }
            if (type === 'code_interpreter') {
                tools.push({ type, container: { type: 'auto' } });
                continue;
            }
            tools.push({ type });
        }
        return tools;
    }
    _imageProvider() {
        return async (item) => {
            const storage = this.ctx.chatluna_storage;
            const format = item.output_format === 'png' || item.output_format === 'jpeg' || item.output_format === 'webp'
                ? item.output_format
                : 'png';
            const ext = format === 'jpeg' ? 'jpg' : format;
            const mime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
            const result = item.result ?? '';
            if (!storage) {
                return `data:${mime};base64,${result}`;
            }
            const file = await storage.createTempFile(Buffer.from(result, 'base64'), `${await (0, string_1.hashString)(result, 8)}.${ext}`);
            return file.url;
        };
    }
}
exports.EndpointRequester = EndpointRequester;
class MultiEndpointRequester extends api_1.ModelRequester {
    constructor(ctx, pool, pluginConfig, plugin, _endpoints, _registry, _logger, _debug) {
        super(ctx, pool, pluginConfig, plugin);
        this._endpoints = _endpoints;
        this._registry = _registry;
        this._logger = _logger;
        this._debug = _debug;
    }
    get logger() {
        return this._logger;
    }
    async *completionStream(params) {
        const requested = params.model ?? '';
        let lastError;
        for (const attempt of this._registry.plan(requested)) {
            const requester = this._requesterFor(attempt);
            let started = false;
            try {
                for await (const chunk of requester.completionStream(this._rewrite(params, attempt.model))) {
                    started = true;
                    yield chunk;
                }
                this._trace('ok', requested, attempt, requester);
                this._registry.reportSuccess(requested, attempt);
                return;
            }
            catch (error) {
                lastError = error;
                this._registry.reportFailure(requested, attempt);
                this._trace('fail', requested, attempt, requester, `started=${started} ${describeError(error)}`);
                if (started || !isFailoverable(error)) {
                    throw error;
                }
            }
        }
        throw toChatLunaError(lastError);
    }
    async completion(params) {
        const requested = params.model ?? '';
        let lastError;
        for (const attempt of this._registry.plan(requested)) {
            const requester = this._requesterFor(attempt);
            try {
                const result = await requester.completion(this._rewrite(params, attempt.model));
                this._trace('ok', requested, attempt, requester);
                this._registry.reportSuccess(requested, attempt);
                return result;
            }
            catch (error) {
                lastError = error;
                this._registry.reportFailure(requested, attempt);
                this._trace('fail', requested, attempt, requester, describeError(error));
                if (!isFailoverable(error)) {
                    throw error;
                }
            }
        }
        throw toChatLunaError(lastError);
    }
    async embeddings(params) {
        return await this._withFailover(params, (requester, model) => requester.embeddings({ ...params, model }));
    }
    async rerank(params) {
        return await this._withFailover(params, (requester, model) => requester.rerank({ ...params, model }));
    }
    async *completionStreamInternal(params) {
        yield* this.completionStream(params);
    }
    buildHeaders() {
        return this._endpoints[0].requester.buildHeaders();
    }
    async _withFailover(params, invoke) {
        const requested = params.model ?? '';
        let lastError;
        for (const attempt of this._registry.plan(requested)) {
            const requester = this._requesterFor(attempt);
            try {
                const result = await invoke(requester, attempt.model);
                this._registry.reportSuccess(requested, attempt);
                return result;
            }
            catch (error) {
                lastError = error;
                this._registry.reportFailure(requested, attempt);
                if (!isFailoverable(error)) {
                    throw error;
                }
            }
        }
        throw toChatLunaError(lastError);
    }
    _requesterFor(attempt) {
        const index = attempt.endpointIndex === constants_1.PRIMARY_ENDPOINT_INDEX ? 0 : attempt.endpointIndex;
        const found = this._endpoints.find((item) => item.index === index);
        if (found == null) {
            throw new error_1.ChatLunaError(error_1.ChatLunaErrorCode.NOT_AVAILABLE_CONFIG, new Error(`模型组中的 API 接口序号 ${attempt.endpointIndex} 不存在，请检查配置`));
        }
        return found.requester;
    }
    _rewrite(params, model) {
        return params.model === model ? params : { ...params, model };
    }
    _trace(result, requested, attempt, requester, detail) {
        if (!this._debug) {
            return;
        }
        const line = `route ${result}: ${requested} -> ${attempt.model} @ api#${requester.endpointIndex}${detail == null ? '' : ` (${detail})`}`;
        if (result === 'ok') {
            this._logger.debug(line);
        }
        else {
            this._logger.warn(line);
        }
    }
}
exports.MultiEndpointRequester = MultiEndpointRequester;
