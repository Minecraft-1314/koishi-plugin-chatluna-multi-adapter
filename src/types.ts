import { ModelCapabilities, ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

import type { EndpointRequester } from './requester'

export type RotationStrategy = 'roundRobin' | 'failover' | 'random'

export type ModelListMode = 'both' | 'groupsOnly' | 'modelsOnly'

export interface ModelGroupEntry {
  enabled: boolean
  name: string
  availableModels: string[]
  models: AdditionalModelEntry[]
  strategy: RotationStrategy
}

export interface AdditionalModelEntry {
  model: string
  modelType: ModelType
  modelCapabilities: ModelCapabilities[]
  contextSize: number
}

export interface Config extends ChatLunaPlugin.Config {
  platform: string
  pullModels: boolean
  modelListMode: ModelListMode
  modelGroups: ModelGroupEntry[]
  additionalModels: AdditionalModelEntry[]
  blacklistModels: string[]
  apiKeys: [string, string, boolean][]
  additionCookies: [string, string][]
  additionHeaders: [string, string][]
  maxContextRatio: number
  temperature: number
  presencePenalty: number
  frequencyPenalty: number
  nonStreaming: boolean
  responseApi: boolean
  setCacheKey: boolean
  googleSearch: boolean
  googleSearchSupportModel: string[]
  responseBuiltinTools: string[]
  responseBuiltinToolSupportModel: string[]
  responseFileSearchVectorStoreIds: string[]
  endpointFailureCooldown: number
  debug: boolean
}

export interface EndpointBinding {
  index: number
  poolIndex: number
  apiEndpoint: string
  requester: EndpointRequester
}

export interface Attempt {
  key: string
  endpointIndex: number
  model: string
}

export interface FailureState {
  failures: number
  cooldownUntil: number
}

export interface GroupRuntime {
  name: string
  strategy: RotationStrategy
  attempts: Attempt[]
  cursor: number
}
