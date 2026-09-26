# koishi-plugin-chatluna-multi-adapter

## 项目介绍 (Project Introduction)

### 中文
这是一个为 Koishi 机器人框架开发的 **ChatLuna 多接口 OpenAI 兼容适配器**，基于 [koishi-plugin-chatluna-openai-like-adapter](https://github.com/ChatLunaLab/chatluna/tree/v1-dev/packages/adapter-openai-like) 改写，补齐了原适配器在多接口场景下的两个空缺。

第一，原适配器只加载一个接口的模型。它的 `refreshModels` 只调用一次 `getModels`，走的是配置池当前选中的那一个接口，所以你在 `apiKeys` 里配了 5 个站，ChatLuna 的模型列表里也只有其中 1 个站的模型。本插件改为**并发拉取全部已启用接口的 `/models`，合并去重后再交给 ChatLuna**，不同 API 网站、不同模型会同时出现在列表里；单个接口拉取失败只跳过该站，只有全部失败才报错。

第二，原适配器没有办法让一个自定义名字背后挂多个真实模型。本插件提供**模型轮换组**：你起一个自定义名称并列出候选模型，ChatLuna 里选这个名称即可使用，实际请求按策略转发到真实模型，出错自动切下一个。

原适配器的全部能力都保留：非流式返回、Responses API、`prompt_cache_key`、Google 搜索、内置工具、代理、额外 Cookie 与 Header。

### English
A **multi-endpoint OpenAI-compatible adapter** for Koishi and ChatLuna, forked from [koishi-plugin-chatluna-openai-like-adapter](https://github.com/ChatLunaLab/chatluna/tree/v1-dev/packages/adapter-openai-like) to close two gaps in multi-site setups.

First, the original adapter only loads models from a single endpoint, so with 5 sites configured ChatLuna shows just one site's models. This plugin pulls `/models` from **every enabled endpoint concurrently**, merges and dedupes the results, and only fails when all endpoints fail. Second, the original cannot back one custom name with several real models; model rotation groups fill that gap with per-request rotation and automatic failover.

Everything the original supports is preserved: non-streaming, Responses API, `prompt_cache_key`, Google search, built-in tools, proxy, extra cookies and headers.

## 生效范围 (Availability)

| 使用场景 (Scenario) | 接入方式 (How) | 说明 (Description) |
|-------------------|----------------|--------------------|
| ChatLuna 主插件 Main plugin | 插件列表启用，填 `apiKeys` | 并发聚合全部接口模型 (aggregates all endpoints) |
| 伪装插件 ChatLuna Character | 与主插件共用同一平台 | 同一 `platform` 名下共用已加载模型 |
| 多站聚合 Multi-site | `apiKeys` 填多行 | 每行一个 Key + 地址，可单独禁用 (one row per site) |
| 模型轮换 Model rotation | 配置 `modelGroups` | 自定义名称对应多个真实模型 |
| 故障转移 Failover | 组策略选 `出错才切换` | 出错自动换模型并冷却退避 |
| 与原适配器并存 | 各自设不同 `platform` | 互不冲突，可灰度迁移 |

> `platform` 是适配器在 ChatLuna 里的唯一标识，必须与已有的 `chatluna-openai-like-adapter` 实例不同，否则会互相覆盖。
> `platform` identifies the adapter in ChatLuna and must differ from any existing `chatluna-openai-like-adapter` instance.

## 核心能力 (Core Capabilities)

| 功能 (Feature) | 说明 (Description) | 示例 (Example) |
|----------------|--------------------|----------------|
| 全接口模型聚合 | 并发拉取所有启用接口并合并去重 | 配 3 个站，模型列表出现三站全部模型 |
| 模型名到接口亲和 | 只在确实提供该模型的接口间分发 | `deepseek-v3` 只发往提供它的站 |
| 模型轮换组 | 自定义名称对应多个真实模型 | 名称 `主力模型` → `gpt-4o` + `claude-sonnet-4-6` |
| 接口锁定 | `接口序号@模型名` 固定走指定站 | `1@kimi-k2` 强制走第 2 行接口 |
| 出错自动切换 | 5xx、限流、模型不存在等自动换下一个 | 首选模型挂了自动切备用 |
| 列表显示范围 | 三档可切：都显示 / 只显示模型组 / 只显示全部模型 | `modelListMode: 只显示模型组` |
| 冷却退避 | 失败的「模型+接口」按次数递增冷却 | 30s → 60s → 5min → 15min → 30min |
| 中断不切换 | 用户主动中止不触发换模型 | 停止生成不会打到别的模型 |

## 模型轮换组 (Model Rotation Groups)

在 `modelGroups` 里配置一行，ChatLuna 的模型列表里就会出现你起的名字。

| 配置项 (Config) | 说明 (Description) |
|----------------|--------------------|
| `enabled` | 是否启用此组。取消勾选后该组不会出现在模型列表里 (tick to include in the model list) |
| `name` | 模型组名称，即 ChatLuna 里 selectable 的模型名 |
| `availableModels` | 从已加载的全部模型中**勾选**，每项前面带 API 请求地址；勾选顺序即轮换顺序，**默认全部不选** |
| `models` | **手写**的模型列表，格式与外部的「额外模型列表」完全一致，排在勾选模型之后 |
| `strategy` | `轮流使用` / `出错才切换` / `随机选择` |

> `availableModels` 的候选项由插件加载时从所有接口拉取后填入，只包含可对话的模型（嵌入、重排、绘图模型不会出现）。若控制台页面在首次加载完成前就已打开，勾选列表会是空的，**刷新一次页面**即可看到。
> Checkbox options are filled in after the plugin pulls models from every endpoint. Refresh the console page once if the list is empty.

组内实际生效的模型 = **勾选的 `availableModels`** + **手写的 `models`**，按此顺序轮换。两者都为空时该组不会被注册。

组的模型类型、上下文大小、支持的能力**由候选模型自动推导**：上下文取候选里最小的那个，能力取所有候选的交集（只有全部候选都支持才会声明），因此不会虚报。手写行里填的 `modelType` / `contextSize` / `modelCapabilities` 会在该模型未被接口拉取到时生效。

### 勾选项为什么带 API 请求地址

`availableModels` 的每一项都是 `API 请求地址 > 模型名`：

```text
https://api.a.com/v1 > gpt-4o
https://api.b.com/v1 > gpt-4o
https://api.c.com/v1 > gpt-4o
```

- **两个供应商提供同名模型时不合并**，各自成一项，勾哪一项就走哪一家。
- **同一个 API 地址配了两行、且都提供该模型时**，地址后面加 `-1` / `-2` / `-3`，按 `apiKeys` 里的先后顺序编号：

```text
https://api.a.com/v1-1 > gpt-4o
https://api.a.com/v1-2 > gpt-4o
```

- 整个列表按 `apiKeys` 的顺序排列，方便对照。

勾选项由插件加载时从所有接口拉取后填入，只包含可对话的模型（嵌入、重排、绘图模型不会出现）。若控制台页面在首次加载完成前就已打开，列表会是空的，**刷新一次页面**即可。

| 策略 (Strategy) | 行为 (Behaviour) |
|----------------|------------------|
| `轮流使用` | 每次请求轮流使用列表中的下一个模型 |
| `出错才切换` | 一直用第一个模型，只有它出错才切下一个；冷却结束后自动回切第一个 |
| `随机选择` | 随机挑选一个当前可用的模型 |

`models` 表格里 `model` 一列支持两种写法：

| 写法 (Syntax) | 含义 (Meaning) |
|---------------|----------------|
| `模型名` | 自动分配到**确实提供该模型**的接口 |
| `接口序号@模型名` | 锁定到 `apiKeys` 中该序号的接口，序号从 `0` 开始 |

> 接口序号按 `apiKeys` 表格的**行下标**计算，被禁用的行仍然占序号。若序号越界，请求会明确报「API 接口序号 N 不存在」。
> The endpoint index is the `apiKeys` row index; disabled rows still occupy an index.

## 故障转移与冷却 (Failover and Cooldown)

- 任意可切换错误（网络异常、5xx、模型不存在、限流等）都会切到下一个候选。
- **用户主动中断不切换**，已产出的内容也不会被第二个模型重写：流式响应一旦吐出内容就不再换模型重放。
- 失败的「模型 + 接口」组合进入冷却，冷却基数由 `endpointFailureCooldown` 决定，随失败次数递增 `30s → 60s → 5min → 15min → 30min`。
- 冷却期内若**所有**候选都不可用，会选剩余时间最短的那个继续尝试，不会直接罢工。
- `failover` 始终优先第一个未冷却的模型，所以首选模型冷却一结束就会自动被重新选中，无需额外配置。

## 模型列表显示范围 (Model List Modes)

`modelListMode` 控制 ChatLuna 的模型列表里出现什么：

| 取值 (Value) | 模型列表里出现什么 (What is listed) |
|---------------|--------------------------------------|
| `both 两个都显示`（默认） | 接口拉到的全部模型 + 额外模型 + 模型组 |
| `groupsOnly 只显示模型组` | 只有模型组，隐藏接口自动拉取的全部模型 |
| `modelsOnly 只显示全部模型` | 接口拉到的全部模型 + 额外模型，不含模型组 |

接口动辄几百个模型、列表太长时用 `groupsOnly`；完全不用模型组、只想用原始模型名时用 `modelsOnly`。

> 这个开关**只影响模型列表显示**，不影响路由。即使某个模型不出现在列表里，它仍然可以作为模型组的成员正常使用，勾选候选项也始终是全部已加载的模型。
> This only affects what is listed; routing and the checkbox candidates always use every loaded model.

## 配置项说明 (Configuration)

### 基本设置 (Basic)

| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `platform` | string | `openai-like-multi` | 适配器平台名，须唯一 (unique adapter name) |
| `pullModels` | boolean | true | 并发拉取全部已启用接口的模型列表 (pull all endpoints) |
| `modelListMode` | string | `both 两个都显示` | 模型列表显示范围，见下 (what to expose) |

### API 接口 (API Endpoints)

| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `apiKeys` | array | `[[]]` | 每行为 `API Key` / `API 请求地址` / `是否启用` (key, endpoint, enabled) |
| `additionHeaders` | array | `[]` | 追加请求头，每行 `名称` / `值` (extra headers) |
| `additionCookies` | array | `[]` | 追加 Cookie，每行 `名称` / `值` (extra cookies) |

### 模型轮换组 (Model Groups)

| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `modelGroups` | array | `[]` | 轮换组列表，每行含名称、候选模型与策略 |
| `modelGroups[].enabled` | boolean | true | 是否启用此组 (enable this group) |
| `modelGroups[].name` | string | 必填 | 对外显示的模型名 (display name) |
| `modelGroups[].availableModels` | array | `[]` | 从已加载模型中勾选，每项带 API 请求地址，默认全不选 (tick from loaded models) |
| `modelGroups[].models` | table | `[]` | 手写模型，格式同「额外模型列表」，排在勾选之后 (manual models) |
| `modelGroups[].strategy` | string | `轮流使用` | 轮换策略 (rotation strategy) |

### 额外模型与过滤 (Additional Models & Filters)

| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `additionalModels` | array | `[]` | 手动补充的模型 (manually added models) |
| `blacklistModels` | array | `[]` | 关键词黑名单，ID 命中即隐藏 (keyword blacklist) |

### 请求设置 (Request)

| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `maxContextRatio` | number | 0.35 | 最大上下文使用比例 (context usage ratio) |
| `temperature` | number | 1 | 回复随机性 (sampling temperature) |
| `presencePenalty` | number | 0 | 重复惩罚 (-2~2) |
| `frequencyPenalty` | number | 0 | 频率惩罚 (-2~2) |
| `nonStreaming` | boolean | false | 强制非流式返回 (force non-streaming) |
| `responseApi` | boolean | false | 改用 Responses API (use Responses API) |
| `setCacheKey` | boolean | true | 是否上传 `prompt_cache_key` |
| `endpointFailureCooldown` | number | 30000 | 失败冷却基数毫秒，随次数递增 (cooldown base) |

### 其他设置 (Other)

| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `googleSearch` | boolean | false | 启用 Google 搜索 (Google search) |
| `googleSearchSupportModel` | array | `gemini-2.0` | 支持搜索的模型 (search-capable models) |
| `responseBuiltinTools` | array | `[]` | Responses API 内置工具 (built-in tools) |
| `responseBuiltinToolSupportModel` | array | gpt 系列 | 支持内置工具的模型 (tool-capable models) |
| `responseFileSearchVectorStoreIds` | array | `[]` | file_search 用的向量库 ID |

`maxRetries`、`timeout`、`chatConcurrentMaxSize`、`chatTimeLimit`、`configMode`、`proxyMode` 沿用 ChatLuna 通用配置，含义与原适配器一致。

### 调试模式 (Debug Mode)

| 配置项 (Config) | 类型 (Type) | 默认值 (Default) | 说明 (Description) |
|----------------|-------------|-------------------|---------------------|
| `debug` | boolean | false | 输出各接口模型数、组展开结果与逐条路由日志 (routing logs) |

## 与原适配器的差异 (Differences from the Original Adapter)

| 行为 (Behaviour) | 原适配器 (Original) | 本插件 (This Plugin) |
|------------------|----------------------|----------------------|
| 拉取模型列表 | 只拉配置池选中的 1 个接口 | 并发拉全部启用接口并合并去重 |
| 单个接口故障 | 整次加载失败 | 跳过该站，其余照常加载 |
| 模型名到接口 | 由配置池决定，可能发到不认识该模型的站 | 只在确实提供该模型的接口间分发 |
| 自定义名称对应多模型 | 不支持 | 支持模型轮换组 |
| 出错自动换模型 | 不支持 | 支持，流式仅在首个 chunk 前切换 |
| 接口级冷却退避 | 无 | 失败组合按次数递增冷却 |

## 项目贡献者 (Contributors)

| 贡献者 (Contributor) | 贡献内容 (Contribution) |
|----------------------|--------------------------|
| [ChatLunaLab](https://github.com/ChatLunaLab/chatluna) | 上游原插件 [koishi-plugin-chatluna-openai-like-adapter](https://github.com/ChatLunaLab/chatluna/tree/v1-dev/packages/adapter-openai-like)，本插件的全部基础能力均来自它 (Upstream original adapter, the base of this plugin) |
| [Minecraft-1314](https://github.com/Minecraft-1314) | Fork 维护者：多接口模型聚合、模型轮换组、故障转移与冷却退避 (Fork maintainer: multi-endpoint aggregation, model rotation groups, failover and cooldown) |

本插件是上游适配器的 fork，非官方插件；问题与需求请优先在本仓库提出，上游通用问题可反馈至 [ChatLunaLab/chatluna](https://github.com/ChatLunaLab/chatluna/issues)。
This plugin is a fork of the upstream adapter and is not an official release. Please report issues here first, and send general upstream questions to ChatLunaLab/chatluna.

（欢迎通过 Issues 或 PR 加入贡献者列表）  
(Welcome to join the contributor list via Issues or PR)

## 许可协议 (License)

本项目采用 [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html) 许可证，与上游适配器保持一致。  
This project is licensed under the GNU Affero General Public License v3.0, consistent with the upstream adapter.

本插件 fork 自 [koishi-plugin-chatluna-openai-like-adapter](https://github.com/ChatLunaLab/chatluna/tree/v1-dev/packages/adapter-openai-like)，原作者 dingyi222666，版权归 ChatLunaLab 及原插件所有，本插件的版权声明一并沿用。  
This plugin is a fork of koishi-plugin-chatluna-openai-like-adapter by dingyi222666. Copyright of the original work belongs to ChatLunaLab and is carried over to this fork.

AGPL-3.0 属于强 copyleft：分发本插件或其衍生作品时，必须以相同许可发布，并保留完整源码与上述版权声明。  
AGPL-3.0 is a strong copyleft licence: any distribution of this plugin or a derivative work must use the same licence and retain the full source code and the copyright notice above.

## 支持我们 (Support Us)

如果这个项目对您有帮助，欢迎点亮右上角的 Star ⭐ 支持我们！  
If this project is helpful to you, please feel free to star it in the upper right corner ⭐ to support us!
