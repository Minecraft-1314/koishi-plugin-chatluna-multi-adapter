"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.usage = exports.Config = exports.inject = exports.name = exports.reusable = exports.logger = void 0;
exports.apply = apply;
const chat_1 = require("koishi-plugin-chatluna/services/chat");
const error_1 = require("koishi-plugin-chatluna/utils/error");
const logger_1 = require("koishi-plugin-chatluna/utils/logger");
const client_1 = require("./client");
const constants_1 = require("./constants");
const config_1 = require("./config");
const requester_1 = require("./requester");
const rotation_1 = require("./rotation");
exports.reusable = true;
exports.name = constants_1.PLUGIN_NAME;
exports.inject = {
    required: ['chatluna'],
    optional: ['chatluna_storage']
};
function buildEndpointBindings(ctx, config, pool, plugin, endpointLogger) {
    return config.apiKeys
        .map(([apiKey, apiEndpoint, enabled], index) => ({ apiKey, apiEndpoint, enabled, index }))
        .filter((item) => item.apiKey.length > 0 && item.enabled)
        .map((item, poolIndex) => {
        const requester = new requester_1.EndpointRequester(ctx, pool, config, plugin, poolIndex, item.index, endpointLogger);
        return {
            index: item.index,
            poolIndex,
            apiEndpoint: item.apiEndpoint,
            requester
        };
    });
}
function apply(ctx, input) {
    const config = (0, config_1.withSchemaDefaults)(input);
    exports.logger = (0, logger_1.createLogger)(ctx, constants_1.PLUGIN_NAME);
    ctx.on('ready', async () => {
        if (config.platform == null || config.platform.length < 1) {
            throw new error_1.ChatLunaError(error_1.ChatLunaErrorCode.UNKNOWN_ERROR, new Error('Cannot find any platform'));
        }
        (0, config_1.normalizeConfig)(config);
        const platform = config.platform;
        const plugin = new chat_1.ChatLunaPlugin(ctx, config, platform);
        const registry = new rotation_1.RotationRegistry((0, rotation_1.resolveBaseCooldown)(config.endpointFailureCooldown));
        const scopedLogger = (0, logger_1.createLogger)(ctx, `${constants_1.PLUGIN_NAME}(${platform})`);
        plugin.parseConfig((current) => current.apiKeys
            .filter(([apiKey, , enabled]) => apiKey.length > 0 && enabled)
            .map(([apiKey, apiEndpoint]) => ({
            apiKey,
            apiEndpoint,
            platform,
            chatLimit: current.chatTimeLimit ?? constants_1.DEFAULT_CHAT_TIME_LIMIT,
            timeout: current.timeout ?? constants_1.DEFAULT_TIMEOUT,
            maxRetries: current.maxRetries,
            concurrentMaxSize: current.chatConcurrentMaxSize ?? constants_1.DEFAULT_CONCURRENT_MAX_SIZE
        })));
        const endpoints = buildEndpointBindings(ctx, config, plugin.platformConfigPool, plugin, scopedLogger);
        if (endpoints.length === 0) {
            scopedLogger.warn(`no enabled API endpoint configured for platform ${platform}`);
        }
        plugin.registerClient(() => new client_1.MultiEndpointOpenAIClient(ctx, config, plugin, endpoints, registry, scopedLogger, config.debug));
        await plugin.initClient();
    });
}
exports.Config = config_1.ConfigSchema;
exports.usage = `
## 多接口 OpenAI 兼容适配器说明

本适配器会并发拉取 apiKeys 中所有已启用接口的模型列表并合并去重，因此不同 API 网站、不同模型会同时出现在模型列表中。

### 模型轮换组

在 modelGroups 中配置一个自定义名称，ChatLuna 里选择该名称即可使用，实际请求会按策略转发到真实模型：

- roundRobin：每次请求轮流使用列表中的下一个模型
- failover：固定使用当前模型，出错时自动切到下一个
- random：随机挑选一个可用模型

models 支持两种写法：模型名（自动分配到提供该模型的接口），或 接口序号@模型名（锁定到 apiKeys 中该序号的接口，序号从 0 开始）。
`;
