"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigSchema = void 0;
exports.normalizeConfig = normalizeConfig;
exports.setAvailableModels = setAvailableModels;
exports.withSchemaDefaults = withSchemaDefaults;
const koishi_1 = require("koishi");
const chat_1 = require("koishi-plugin-chatluna/services/chat");
const types_1 = require("koishi-plugin-chatluna/llm-core/platform/types");
const constants_1 = require("./constants");
const LLM_TYPE_LABEL = 'LLM 大语言模型';
const EMBEDDINGS_TYPE_LABEL = 'Embeddings 嵌入模型';
const RERANKER_TYPE_LABEL = 'Reranker 重排序模型';
const ROUND_ROBIN_LABEL = '轮流使用';
const FAILOVER_LABEL = '出错才切换';
const RANDOM_LABEL = '随机选择';
const MODEL_LIST_BOTH_LABEL = '两个都显示';
const MODEL_LIST_GROUPS_ONLY_LABEL = '只显示模型组';
const MODEL_LIST_MODELS_ONLY_LABEL = '只显示全部模型';
const CAPABILITY_OPTIONS = [
    types_1.ModelCapabilities.TextInput,
    types_1.ModelCapabilities.ToolCall,
    types_1.ModelCapabilities.ImageInput,
    types_1.ModelCapabilities.ImageGeneration
];
const modelTypeSchema = koishi_1.Schema.union([LLM_TYPE_LABEL, EMBEDDINGS_TYPE_LABEL, RERANKER_TYPE_LABEL]);
const modelOptions = koishi_1.Schema.union([]);
const modelEntrySchema = koishi_1.Schema.object({
    model: koishi_1.Schema.string(),
    modelType: modelTypeSchema.default(LLM_TYPE_LABEL),
    modelCapabilities: koishi_1.Schema.array(koishi_1.Schema.union(CAPABILITY_OPTIONS))
        .default([types_1.ModelCapabilities.TextInput, types_1.ModelCapabilities.ToolCall])
        .role('checkbox'),
    contextSize: koishi_1.Schema.number().default(constants_1.DEFAULT_CONTEXT_SIZE)
});
function buildType(modelType) {
    if (modelType === EMBEDDINGS_TYPE_LABEL) {
        return types_1.ModelType.embeddings;
    }
    if (modelType === RERANKER_TYPE_LABEL) {
        return types_1.ModelType.reranker;
    }
    return types_1.ModelType.llm;
}
function buildStrategy(strategy) {
    if (strategy === FAILOVER_LABEL || strategy === 'failover') {
        return 'failover';
    }
    if (strategy === RANDOM_LABEL || strategy === 'random') {
        return 'random';
    }
    return 'roundRobin';
}
function buildModelListMode(mode) {
    if (mode === MODEL_LIST_GROUPS_ONLY_LABEL || mode === 'groupsOnly') {
        return 'groupsOnly';
    }
    if (mode === MODEL_LIST_MODELS_ONLY_LABEL || mode === 'modelsOnly') {
        return 'modelsOnly';
    }
    return 'both';
}
function normalizeConfig(config) {
    config.modelListMode = buildModelListMode(config.modelListMode);
    for (const group of config.modelGroups ?? []) {
        group.enabled = group.enabled ?? true;
        group.strategy = buildStrategy(group.strategy);
        group.availableModels = (group.availableModels ?? []).filter((item) => typeof item === 'string' && item.trim().length > 0);
        group.models = normalizeModelEntries(group.models);
    }
    config.additionalModels = normalizeModelEntries(config.additionalModels);
}
function normalizeModelEntries(entries) {
    const result = [];
    for (const raw of (entries ?? [])) {
        const model = (typeof raw === 'string' ? raw : raw?.model)?.trim();
        if (!model) {
            continue;
        }
        const entry = (typeof raw === 'string' ? {} : raw);
        entry.model = model;
        entry.modelType = buildType(entry.modelType);
        entry.modelCapabilities =
            entry.modelCapabilities ?? [types_1.ModelCapabilities.TextInput, types_1.ModelCapabilities.ToolCall];
        entry.contextSize = Number.isFinite(entry.contextSize) ? entry.contextSize : constants_1.DEFAULT_CONTEXT_SIZE;
        result.push(entry);
    }
    return result;
}
const baseSchema = koishi_1.Schema.intersect([
    chat_1.ChatLunaPlugin.Config,
    koishi_1.Schema.object({
        platform: koishi_1.Schema.string().default('openai-like-multi'),
        pullModels: koishi_1.Schema.boolean().default(true),
        modelListMode: koishi_1.Schema.union([
            MODEL_LIST_BOTH_LABEL,
            MODEL_LIST_GROUPS_ONLY_LABEL,
            MODEL_LIST_MODELS_ONLY_LABEL
        ]).default(MODEL_LIST_BOTH_LABEL),
        modelGroups: koishi_1.Schema.array(koishi_1.Schema.object({
            enabled: koishi_1.Schema.boolean().default(true).role('checkbox'),
            name: koishi_1.Schema.string(),
            availableModels: koishi_1.Schema.array(modelOptions).role('checkbox').default([]),
            models: koishi_1.Schema.array(modelEntrySchema).default([]).role('table'),
            strategy: koishi_1.Schema.union([ROUND_ROBIN_LABEL, FAILOVER_LABEL, RANDOM_LABEL]).default(ROUND_ROBIN_LABEL)
        }))
            .default([])
            .role('table'),
        additionalModels: koishi_1.Schema.array(modelEntrySchema).default([]).role('table'),
        blacklistModels: koishi_1.Schema.array(koishi_1.Schema.string()).default([])
    }),
    koishi_1.Schema.object({
        apiKeys: koishi_1.Schema.array(koishi_1.Schema.tuple([
            koishi_1.Schema.string().role('secret').default(''),
            koishi_1.Schema.string().default('https://api.openai.com/v1'),
            koishi_1.Schema.boolean().default(true)
        ]))
            .default([[]])
            .role('table'),
        additionCookies: koishi_1.Schema.array(koishi_1.Schema.tuple([koishi_1.Schema.string(), koishi_1.Schema.string()])).default([]),
        additionHeaders: koishi_1.Schema.array(koishi_1.Schema.tuple([koishi_1.Schema.string(), koishi_1.Schema.string()])).default([])
    }),
    koishi_1.Schema.object({
        maxContextRatio: koishi_1.Schema.number()
            .min(0)
            .max(1)
            .step(1e-4)
            .role('slider')
            .default(constants_1.DEFAULT_MAX_CONTEXT_RATIO),
        temperature: koishi_1.Schema.percent().min(0).max(2).step(0.1).default(constants_1.DEFAULT_TEMPERATURE),
        presencePenalty: koishi_1.Schema.number().min(-2).max(2).step(0.1).default(0),
        frequencyPenalty: koishi_1.Schema.number().min(-2).max(2).step(0.1).default(0),
        nonStreaming: koishi_1.Schema.boolean().default(false),
        responseApi: koishi_1.Schema.boolean().default(false),
        setCacheKey: koishi_1.Schema.boolean().default(true),
        endpointFailureCooldown: koishi_1.Schema.number().min(0).default(constants_1.DEFAULT_ENDPOINT_FAILURE_COOLDOWN),
        debug: koishi_1.Schema.boolean().default(false)
    }),
    koishi_1.Schema.object({
        googleSearch: koishi_1.Schema.boolean().default(false),
        googleSearchSupportModel: koishi_1.Schema.array(koishi_1.Schema.string()).default(['gemini-2.0']),
        responseBuiltinTools: koishi_1.Schema.array(koishi_1.Schema.union([
            'web_search',
            'web_search_preview',
            'image_generation',
            'code_interpreter',
            'file_search'
        ]))
            .default([])
            .role('checkbox'),
        responseBuiltinToolSupportModel: koishi_1.Schema.array(koishi_1.Schema.string()).default([
            'gpt-4o',
            'gpt-4o-mini',
            'gpt-5.1',
            'gpt-5.2',
            'gpt-5.3',
            'gpt-5.4',
            'gpt-5.5',
            'gpt-5',
            'gpt-5-mini',
            'gpt-5-nano'
        ]),
        responseFileSearchVectorStoreIds: koishi_1.Schema.array(koishi_1.Schema.string()).default([])
    })
]);
exports.ConfigSchema = baseSchema.i18n({
    'zh-CN': {
        $inner: [
            {},
            {
                $desc: '适配器配置',
                platform: '设置适配器平台名称。',
                pullModels: '是否自动拉取模型列表。关闭后将仅使用下方指定的模型。开启后会并发拉取全部已启用接口并合并去重。',
                modelListMode: 'ChatLuna 模型列表显示哪些内容：两个都显示 / 只显示模型组 / 只显示全部模型。仅影响列表显示，路由与模型组勾选候选始终基于全部已加载模型。',
                modelGroups: {
                    $desc: '模型轮换组',
                    $inner: {
                        enabled: '是否启用此组',
                        name: '模型组名称。在 ChatLuna 中选择该名称即可使用，实际请求会转发到下方真实模型。',
                        availableModels: '从已加载的全部模型中勾选，每项前面是 API 请求地址，勾选顺序即轮换顺序。两个供应商提供同名模型时不会合并。',
                        models: {
                            $desc: '手写的真实模型列表，排在勾选模型之后',
                            $inner: {
                                model: '模型名称。可写 模型名，或 接口序号@模型名 锁定到指定 API 接口（序号从 0 开始）。',
                                modelType: '模型类型。',
                                contextSize: '模型上下文大小。',
                                modelCapabilities: {
                                    $desc: '模型支持的能力',
                                    $inner: ['工具调用', '图片视觉输入']
                                }
                            }
                        },
                        strategy: '轮换策略。出错才切换表示固定使用当前模型，出错时才切到下一个。'
                    }
                },
                additionalModels: {
                    $desc: '额外模型列表',
                    $inner: {
                        model: '模型名称。',
                        modelType: '模型类型。',
                        contextSize: '模型上下文大小。',
                        modelCapabilities: {
                            $desc: '模型支持的能力',
                            $inner: ['工具调用', '图片视觉输入']
                        }
                    }
                },
                blacklistModels: {
                    $desc: '关键词黑名单模型列表。将隐藏 ID 中含有以下关键词的模型。',
                    $inner: ['关键词']
                }
            },
            {
                $desc: '请求设置',
                apiKeys: {
                    $inner: ['API Key', 'API 请求地址', '是否启用此配置'],
                    $desc: '配置 API Key 和对应的请求地址列表。序号即模型轮换组中可用于锁定的接口序号。'
                },
                additionCookies: { $inner: ['Cookie 名称', 'Cookie 值'], $desc: '设置额外的 Cookie。' },
                additionHeaders: { $inner: ['Header 名称', 'Header 值'], $desc: '设置额外的请求头。' }
            },
            {
                $desc: '模型设置',
                maxContextRatio: '最大上下文使用比例（0~1），控制可用的模型上下文窗口大小的最大百分比。例如 0.35 表示最多使用模型上下文的 35%。',
                temperature: '回复的随机性程度，数值越高，回复越随机。',
                presencePenalty: '重复惩罚系数，数值越高，越不易重复出现已出现过至少一次的 Token（范围：-2~2，步长：0.1）。',
                frequencyPenalty: '频率惩罚系数，数值越高，越不易重复出现次数较多的 Token（范围：-2~2，步长：0.1）。',
                nonStreaming: '强制不启用流式返回。开启后，将总是以非流式发起请求，即便配置了 stream 参数。',
                responseApi: '是否启用 OpenAI Responses API。默认关闭，关闭时继续使用 Chat Completions API。',
                setCacheKey: '是否上传 prompt_cache_key。关闭后请求中不会包含 prompt_cache_key。',
                endpointFailureCooldown: '模型或接口失败后的冷却基数（毫秒），按失败次数递增。冷却期内不会选中该模型与接口的组合。',
                debug: '输出各接口模型数、模型轮换组展开结果与逐条请求的路由日志。'
            },
            {
                $desc: '其他设置',
                googleSearch: '是否启用 Google 搜索。（只对支持 google 搜索的 gemini 模型 且为 new-api 的端点有效）',
                googleSearchSupportModel: 'Google 搜索支持的模型列表。',
                responseBuiltinTools: '启用的 OpenAI Responses API 内置工具。可选网页搜索、图片生成、代码解释器和文件搜索；computer 类工具未提供。',
                responseBuiltinToolSupportModel: 'OpenAI Responses API 内置工具支持的模型列表。',
                responseFileSearchVectorStoreIds: '文件搜索使用的 Vector Store ID 列表。启用 file_search 时必须填写。'
            }
        ]
    },
    'en-US': {
        $inner: [
            {},
            {
                $desc: 'Adapter Configuration',
                platform: 'Adapter platform name',
                pullModels: 'Auto-fetch model list. If disabled, use only specified models. When enabled, every enabled endpoint is pulled concurrently and merged.',
                modelListMode: 'What the ChatLuna model list contains: both, groups only, or models only. Routing and checkbox candidates always use every loaded model.',
                modelGroups: {
                    $desc: 'Model rotation groups',
                    $inner: {
                        enabled: 'Whether this group is enabled',
                        name: 'Model group name. Selecting it in ChatLuna forwards the request to the real models below.',
                        availableModels: 'Tick from every model loaded so far, each prefixed with its API endpoint; the tick order is the rotation order. Same model name from two providers is listed separately.',
                        models: {
                            $desc: 'Manually written models, appended after the ticked ones',
                            $inner: {
                                model: 'Model name. Use model, or endpointIndex@model to pin one API endpoint (0-based).',
                                modelType: 'Model type',
                                contextSize: 'Context size',
                                modelCapabilities: {
                                    $desc: 'Model supported capabilities',
                                    $inner: ['Tool calling', 'Visual image input']
                                }
                            }
                        },
                        strategy: 'Rotation strategy. "Only switch on error" keeps the current model until it fails.'
                    }
                },
                additionalModels: {
                    $desc: 'Additional models',
                    $inner: {
                        model: 'Model name',
                        modelType: 'Model type',
                        contextSize: 'Context size',
                        modelCapabilities: {
                            $desc: 'Model supported capabilities',
                            $inner: ['Tool calling', 'Visual image input']
                        }
                    }
                },
                blacklistModels: {
                    $desc: 'Keyword blacklist models. Hide models whose IDs contain these keywords.',
                    $inner: ['Keyword']
                }
            },
            {
                $desc: 'API Configuration',
                apiKeys: {
                    $inner: ['API Key', 'API Endpoint', 'Enabled'],
                    $desc: 'API Keys and endpoints. The row index is the endpoint index usable in model groups.'
                },
                additionCookies: { $inner: ['Cookie name', 'Cookie value'], $desc: 'Additional cookies' },
                additionHeaders: { $inner: ['Header name', 'Header value'], $desc: 'Additional request headers' }
            },
            {
                $desc: 'Model Parameters',
                maxContextRatio: 'Maximum context usage ratio (0-1). Controls the maximum percentage of model context window available for use. For example, 0.35 means at most 35% of the model context can be used.',
                temperature: 'Sampling temperature (higher values increase randomness)',
                presencePenalty: 'Token presence penalty (-2 to 2, step 0.1, discourages repetition)',
                frequencyPenalty: 'Token frequency penalty (-2 to 2, step 0.1, reduces repetition)',
                nonStreaming: 'Force disable streaming response. When enabled, requests will always be made in non-streaming mode, even if the stream parameter is configured.',
                responseApi: 'Enable OpenAI Responses API. Disabled by default; when disabled, Chat Completions API is used.',
                setCacheKey: 'Whether to send prompt_cache_key. When disabled, requests will not include prompt_cache_key.',
                endpointFailureCooldown: 'Base cooldown in milliseconds after a model or endpoint failure, growing with each failure. The model and endpoint pair is skipped while cooling.',
                debug: 'Log per-endpoint model counts, model group expansion and per-request routing decisions.'
            },
            {
                $desc: 'Other settings',
                googleSearch: 'Whether to enable Google search. (Only valid for Gemini models that support Google search and use the new-api)',
                googleSearchSupportModel: 'List of models supported by Google search.',
                responseBuiltinTools: 'Enabled OpenAI Responses API built-in tools. Supports web search, image generation, code interpreter, and file search; computer tools are not exposed.',
                responseBuiltinToolSupportModel: 'Models that support Responses API built-in tools.',
                responseFileSearchVectorStoreIds: 'Vector Store IDs used by file_search. Required when file_search is enabled.'
            }
        ]
    }
});
function resolveModelOptions() {
    const group = exports.ConfigSchema.list[1].dict.modelGroups;
    return group.inner.dict.availableModels.inner;
}
function setAvailableModels(models) {
    const target = resolveModelOptions();
    const list = target.list ?? (target.list = []);
    const options = [...new Set(models)];
    list.splice(0, list.length, ...options.map((model) => koishi_1.Schema.const(model).description(model)));
}
function withSchemaDefaults(input) {
    if (input == null) {
        return (0, exports.ConfigSchema)(null);
    }
    if (input.platform == null || input.apiKeys == null) {
        const defaults = (0, exports.ConfigSchema)(null);
        const target = input;
        const source = defaults;
        for (const key of Object.keys(source)) {
            if (target[key] === undefined) {
                target[key] = source[key];
            }
        }
    }
    return input;
}
