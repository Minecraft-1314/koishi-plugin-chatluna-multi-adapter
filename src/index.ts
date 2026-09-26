import { Context, Logger, Schema } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
  ChatLunaError as ChatLunaError2,
  ChatLunaErrorCode as ChatLunaErrorCode2
} from 'koishi-plugin-chatluna/utils/error'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'

import { MultiEndpointOpenAIClient } from './client'
import {
  DEFAULT_CHAT_TIME_LIMIT,
  DEFAULT_CONCURRENT_MAX_SIZE,
  DEFAULT_TIMEOUT,
  PLUGIN_NAME
} from './constants'
import { ConfigSchema, normalizeConfig, withSchemaDefaults } from './config'
import { EndpointRequester } from './requester'
import { resolveBaseCooldown, RotationRegistry } from './rotation'
import { Config as MultiAdapterConfig, EndpointBinding } from './types'

export let logger: Logger
export const reusable = true
export const name = PLUGIN_NAME
export const inject = {
  required: ['chatluna'],
  optional: ['chatluna_storage']
}

function buildEndpointBindings(
  ctx: Context,
  config: MultiAdapterConfig,
  pool: any,
  plugin: any,
  endpointLogger: Logger
): EndpointBinding[] {
  return config.apiKeys
    .map(([apiKey, apiEndpoint, enabled], index) => ({ apiKey, apiEndpoint, enabled, index }))
    .filter((item) => item.apiKey.length > 0 && item.enabled)
    .map((item, poolIndex) => {
      const requester = new EndpointRequester(
        ctx,
        pool,
        config,
        plugin,
        poolIndex,
        item.index,
        endpointLogger
      )
      return {
        index: item.index,
        poolIndex,
        apiEndpoint: item.apiEndpoint,
        requester
      }
    })
}

export function apply(ctx: Context, input: MultiAdapterConfig): void {
  const config = withSchemaDefaults(input)
  logger = createLogger(ctx, PLUGIN_NAME)

  ctx.on('ready', async () => {
    if (config.platform == null || config.platform.length < 1) {
      throw new ChatLunaError2(
        ChatLunaErrorCode2.UNKNOWN_ERROR,
        new Error('Cannot find any platform')
      )
    }
    normalizeConfig(config)
    const platform = config.platform
    const plugin = new ChatLunaPlugin(ctx, config, platform)
    const registry = new RotationRegistry(resolveBaseCooldown(config.endpointFailureCooldown))
    const scopedLogger = createLogger(ctx, `${PLUGIN_NAME}(${platform})`)

    plugin.parseConfig((current) =>
      current.apiKeys
        .filter(([apiKey, , enabled]) => apiKey.length > 0 && enabled)
        .map(([apiKey, apiEndpoint]) => ({
          apiKey,
          apiEndpoint,
          platform,
          chatLimit: current.chatTimeLimit ?? DEFAULT_CHAT_TIME_LIMIT,
          timeout: current.timeout ?? DEFAULT_TIMEOUT,
          maxRetries: current.maxRetries,
          concurrentMaxSize: current.chatConcurrentMaxSize ?? DEFAULT_CONCURRENT_MAX_SIZE
        }))
    )

    const endpoints: EndpointBinding[] = buildEndpointBindings(
      ctx,
      config,
      plugin.platformConfigPool,
      plugin,
      scopedLogger
    )

    if (endpoints.length === 0) {
      scopedLogger.warn(`no enabled API endpoint configured for platform ${platform}`)
    }

    plugin.registerClient(
      () =>
        new MultiEndpointOpenAIClient(
          ctx,
          config,
          plugin,
          endpoints,
          registry,
          scopedLogger,
          config.debug
        ) as any
    )
    await plugin.initClient()
  })
}

export const Config: Schema<MultiAdapterConfig> = ConfigSchema

export const usage = `
## 多接口 OpenAI 兼容适配器说明

本适配器会并发拉取 apiKeys 中所有已启用接口的模型列表并合并去重，因此不同 API 网站、不同模型会同时出现在模型列表中。

### 模型轮换组

在 modelGroups 中配置一个自定义名称，ChatLuna 里选择该名称即可使用，实际请求会按策略转发到真实模型：

- roundRobin：每次请求轮流使用列表中的下一个模型
- failover：固定使用当前模型，出错时自动切到下一个
- random：随机挑选一个可用模型

models 支持两种写法：模型名（自动分配到提供该模型的接口），或 接口序号@模型名（锁定到 apiKeys 中该序号的接口，序号从 0 开始）。
`
