import {
  FAILURE_COOLDOWN_MULTIPLIERS,
  MAX_FAILURE_COOLDOWN,
  MODEL_ENDPOINT_SEPARATOR,
  PRIMARY_ENDPOINT_INDEX
} from './constants'
import { Attempt, FailureState, GroupRuntime, RotationStrategy } from './types'

function buildAttempt(groupName: string, model: string, endpointIndex: number): Attempt {
  return { key: `${groupName}\u0000${endpointIndex}\u0000${model}`, endpointIndex, model }
}

function isCooling(state: FailureState | undefined, now: number): boolean {
  return state != null && state.cooldownUntil > now
}

function rotate<T>(items: T[], offset: number): T[] {
  if (items.length === 0) {
    return []
  }
  const start = ((offset % items.length) + items.length) % items.length
  return [...items.slice(start), ...items.slice(0, start)]
}

function pickLeastCooling(attempts: Attempt[], failures: Map<string, FailureState>): Attempt[] {
  let chosen: Attempt | undefined
  let chosenUntil = Number.POSITIVE_INFINITY
  for (const attempt of attempts) {
    const until = failures.get(attempt.key)?.cooldownUntil ?? 0
    if (until < chosenUntil) {
      chosenUntil = until
      chosen = attempt
    }
  }
  return chosen == null ? [] : [chosen]
}

export function resolveBaseCooldown(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0
  }
  return Math.min(value, MAX_FAILURE_COOLDOWN)
}

export class RotationRegistry {
  private readonly _groups = new Map<string, GroupRuntime>()
  private readonly _failures = new Map<string, FailureState>()
  private readonly _modelEndpoints = new Map<string, number[]>()
  private readonly _modelLabels = new Map<string, Attempt>()
  private _plainCursor = 0

  constructor(private readonly _baseCooldown: number) {}

  setGroups(entries: { name: string; models: string[]; strategy: RotationStrategy }[]): void {
    this._groups.clear()
    for (const entry of entries) {
      const name = entry.name?.trim()
      if (!name) {
        continue
      }
      const attempts = this._buildAttempts(name, entry.models ?? [])
      if (attempts.length === 0) {
        continue
      }
      this._groups.set(name, {
        name,
        strategy: entry.strategy,
        attempts,
        cursor: 0
      })
    }
  }

  setModelEndpoints(index: Map<string, number[]>): void {
    this._modelEndpoints.clear()
    for (const [model, endpoints] of index) {
      this._modelEndpoints.set(model, [...endpoints])
    }
  }

  setModelLabels(labels: Map<string, Attempt>): void {
    this._modelLabels.clear()
    for (const [label, attempt] of labels) {
      this._modelLabels.set(label, attempt)
    }
  }

  getGroup(name: string): GroupRuntime | undefined {
    return this._groups.get(name)
  }

  hasGroup(name: string): boolean {
    return this._groups.has(name)
  }

  listGroups(): GroupRuntime[] {
    return [...this._groups.values()]
  }

  resolveEndpoints(model: string): number[] {
    return [...(this._modelEndpoints.get(model) ?? [])]
  }

  resolvePrimaryModel(model: string): string | null {
    const group = this._groups.get(model)
    if (group != null) {
      return group.attempts[0]?.model ?? null
    }
    return model
  }

  plan(model: string): Attempt[] {
    const group = this._groups.get(model)
    return group == null ? this._planPlainModel(model) : this._planGroup(group)
  }

  reportSuccess(_model: string, attempt: Attempt): void {
    this._failures.delete(attempt.key)
  }

  reportFailure(_model: string, attempt: Attempt): void {
    const previous = this._failures.get(attempt.key)
    const failures = (previous?.failures ?? 0) + 1
    const index = Math.min(failures - 1, FAILURE_COOLDOWN_MULTIPLIERS.length - 1)
    const cooldown = Math.min(this._baseCooldown * FAILURE_COOLDOWN_MULTIPLIERS[index], MAX_FAILURE_COOLDOWN)
    this._failures.set(attempt.key, {
      failures,
      cooldownUntil: Date.now() + cooldown
    })
  }

  cooldownRemaining(key: string): number {
    const state = this._failures.get(key)
    return state == null ? 0 : Math.max(0, state.cooldownUntil - Date.now())
  }

  private _buildAttempts(groupName: string, models: string[]): Attempt[] {
    const attempts: Attempt[] = []
    const seen = new Set<string>()
    for (const raw of models) {
      const value = typeof raw === 'string' ? raw.trim() : ''
      if (!value) {
        continue
      }
      const labelled = this._modelLabels.get(value)
      if (labelled != null) {
        const attempt: Attempt = { ...labelled, key: `${groupName}\u0000${labelled.endpointIndex}\u0000${labelled.model}` }
        if (!seen.has(attempt.key)) {
          seen.add(attempt.key)
          attempts.push(attempt)
        }
        continue
      }
      const separator = value.indexOf(MODEL_ENDPOINT_SEPARATOR)
      const hasEndpoint = separator > 0
      const endpointToken = hasEndpoint ? value.slice(0, separator).trim() : ''
      const model = (hasEndpoint ? value.slice(separator + 1) : value).trim()
      if (!model) {
        continue
      }
      let endpointIndex = PRIMARY_ENDPOINT_INDEX
      if (hasEndpoint) {
        if (!/^\d+$/.test(endpointToken)) {
          continue
        }
        endpointIndex = Number.parseInt(endpointToken, 10)
      } else {
        const known = this._modelEndpoints.get(model)
        endpointIndex = known != null && known.length > 0 ? known[0] : PRIMARY_ENDPOINT_INDEX
      }
      const attempt = buildAttempt(groupName, model, endpointIndex)
      if (seen.has(attempt.key)) {
        continue
      }
      seen.add(attempt.key)
      attempts.push(attempt)
    }
    return attempts
  }

  private _planPlainModel(model: string): Attempt[] {
    const name = `__plain__\u0000${model}`
    const endpoints = this._modelEndpoints.get(model) ?? []
    const now = Date.now()
    const healthy = endpoints.filter(
      (index) => !isCooling(this._failures.get(buildAttempt(name, model, index).key), now)
    )
    if (healthy.length === 0) {
      return [buildAttempt(name, model, PRIMARY_ENDPOINT_INDEX)]
    }
    const offset = healthy.length === 1 ? 0 : this._plainCursor++ % healthy.length
    return rotate(healthy, offset).map((index) => buildAttempt(name, model, index))
  }

  private _planGroup(group: GroupRuntime): Attempt[] {
    const now = Date.now()
    const attempts = group.attempts
    if (attempts.length === 1) {
      return attempts
    }
    if (group.strategy === 'random') {
      const healthy = attempts.filter((attempt) => !isCooling(this._failures.get(attempt.key), now))
      if (healthy.length === 0) {
        return pickLeastCooling(attempts, this._failures)
      }
      return rotate(healthy, Math.floor(Math.random() * healthy.length))
    }
    if (group.strategy === 'roundRobin') {
      const ordered = rotate(attempts, group.cursor++)
      const healthy = ordered.filter((attempt) => !isCooling(this._failures.get(attempt.key), now))
      return healthy.length > 0 ? healthy : pickLeastCooling(ordered, this._failures)
    }
    const ordered = attempts
    const healthy = ordered.filter((attempt) => !isCooling(this._failures.get(attempt.key), now))
    return healthy.length > 0 ? healthy : pickLeastCooling(ordered, this._failures)
  }
}
