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

在 modelGroups 中配置一行，ChatLuna 的模型列表里就会出现你起的名字，实际请求按策略转发到真实模型。

- **enabled**：是否启用此组，取消勾选后该组不出现在模型列表里。
- **name**：模型组名称，即 ChatLuna 里选择的模型名。
- **availableModels**：从已加载的全部模型中勾选，**默认全部不选**。每项前面带 API 请求地址，两个供应商提供同名模型时不合并；同一地址配了两行且都提供该模型时，地址后加 -1 / -2，按 apiKeys 顺序编号。勾选顺序即轮换顺序。
- **models**：手写的模型列表，格式与上方「额外模型列表」完全一致，排在勾选模型之后。model 一列支持 模型名 或 接口序号@模型名（锁定到 apiKeys 中该序号的接口，序号从 0 开始，被禁用的行也占序号）。
- **strategy**：轮流使用 / 出错才切换 / 随机选择。

组的模型类型、上下文大小与支持能力由候选模型自动推导：上下文取候选里最小的那个，能力取所有候选的交集，不虚报。

组内实际生效的模型 = 勾选的 availableModels + 手写的 models，两者都为空时该组不会被注册。

### 其他

- **modelListMode**：模型列表显示范围。两个都显示（默认）/ 只显示模型组 / 只显示全部模型。仅影响列表显示，不影响路由与勾选候选。
- **endpointFailureCooldown**：失败冷却基数（毫秒，默认 30000），按失败次数递增 30s → 60s → 5min → 15min → 30min。冷却期内不会选中该「模型 + 接口」组合，冷却结束自动回切首选模型。
- **debug**：输出各接口模型数、模型组展开结果与逐条请求的路由日志。
`
