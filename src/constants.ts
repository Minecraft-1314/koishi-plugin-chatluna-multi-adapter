export const PLUGIN_NAME = 'chatluna-multi-adapter'

export const DEFAULT_CONTEXT_SIZE = 128_000
export const DEFAULT_MAX_CONTEXT_RATIO = 0.35
export const DEFAULT_TEMPERATURE = 1
export const DEFAULT_TIMEOUT = 300 * 1e3
export const DEFAULT_CONCURRENT_MAX_SIZE = 3
export const DEFAULT_CHAT_TIME_LIMIT = 200

export const MODEL_ENDPOINT_SEPARATOR = '@'
export const MODEL_LABEL_SEPARATOR = ' > '
export const PRIMARY_ENDPOINT_INDEX = -1

export const FAILURE_COOLDOWN_MULTIPLIERS = [1, 2, 10, 30, 60]
export const MAX_FAILURE_COOLDOWN = 30 * 60e3
export const DEFAULT_ENDPOINT_FAILURE_COOLDOWN = 30e3
