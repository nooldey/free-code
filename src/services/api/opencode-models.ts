import isEqual from 'lodash-es/isEqual.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { getInitialSettings } from '../../utils/settings/settings.js'

const DEFAULT_OPENCODE_BASE_URL = 'https://opencode.ai/zen/v1'

export type OpenCodePlan = 'go' | 'zen'
export type OpenCodeProtocol = 'anthropic' | 'oa-compat' | 'responses'

export type OpenCodeConfiguredModelEntry =
  | string
  | {
      id: string
      name?: string
      description?: string
      protocol?: OpenCodeProtocol
    }

export interface OpenCodeModelDefinition {
  id: string
  name?: string
  description?: string
  protocol?: OpenCodeProtocol
}

export const OPENCODE_ZEN_RESPONSE_MODELS = [
  'gpt-5.4',
  'gpt-5.4-pro',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.1',
  'gpt-5.1-codex',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5',
  'gpt-5-codex',
  'gpt-5-nano',
] as const

export const OPENCODE_GO_MODELS = [
  'glm-5.1',
  'glm-5',
  'kimi-k2.5',
  'mimo-v2-pro',
  'mimo-v2-omni',
  'minimax-m2.7',
  'minimax-m2.5',
] as const

const OPENCODE_GO_ANTHROPIC_MODEL_SET: ReadonlySet<string> = new Set([
  'minimax-m2.7',
  'minimax-m2.5',
])

const OPENCODE_ZEN_RESPONSE_MODEL_SET: ReadonlySet<string> = new Set<string>(
  OPENCODE_ZEN_RESPONSE_MODELS,
)

const DOCUMENTED_FREE_ZEN_MODEL_SET: ReadonlySet<string> = new Set([
  'big-pickle',
])

const UNSUPPORTED_ZEN_MODEL_PREFIXES = ['gemini-']

const DEFAULT_OPENCODE_GO_MODEL_DEFINITIONS: OpenCodeModelDefinition[] = [
  {
    id: 'kimi-k2.5',
    description: 'OpenCode Go · Low-cost reasoning model',
    protocol: 'oa-compat',
  },
  {
    id: 'glm-5.1',
    description: 'OpenCode Go · Strong coding and reasoning',
    protocol: 'oa-compat',
  },
  {
    id: 'glm-5',
    description: 'OpenCode Go · Balanced open coding model',
    protocol: 'oa-compat',
  },
  {
    id: 'minimax-m2.7',
    description: 'OpenCode Go · Fast Anthropic-compatible model',
    protocol: 'anthropic',
  },
  {
    id: 'minimax-m2.5',
    description: 'OpenCode Go · Cheapest high-volume option',
    protocol: 'anthropic',
  },
  {
    id: 'mimo-v2-pro',
    description: 'OpenCode Go · OpenAI-compatible reasoning model',
    protocol: 'oa-compat',
  },
  {
    id: 'mimo-v2-omni',
    description: 'OpenCode Go · Multimodal open coding model',
    protocol: 'oa-compat',
  },
]

/**
 * 推断当前适配层对某个 OpenCode 模型应使用的协议。
 */
export function inferOpenCodeProtocol(
  plan: OpenCodePlan,
  modelId: string,
): OpenCodeProtocol | undefined {
  const normalized = modelId.trim().toLowerCase()
  if (!normalized) {
    return undefined
  }

  if (plan === 'go') {
    if (
      OPENCODE_GO_ANTHROPIC_MODEL_SET.has(normalized) ||
      normalized.startsWith('claude-')
    ) {
      return 'anthropic'
    }
    return 'oa-compat'
  }

  if (normalized.startsWith('claude-')) {
    return 'anthropic'
  }
  if (
    OPENCODE_ZEN_RESPONSE_MODEL_SET.has(normalized) ||
    normalized.startsWith('gpt-') ||
    normalized.includes('codex')
  ) {
    return 'responses'
  }
  if (
    UNSUPPORTED_ZEN_MODEL_PREFIXES.some(prefix => normalized.startsWith(prefix))
  ) {
    return undefined
  }
  return 'oa-compat'
}

/**
 * 判断 Zen 模型是否属于应自动展示的免费模型。
 */
export function isOpenCodeZenFreeModel(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase()
  return (
    normalized.endsWith('-free') ||
    DOCUMENTED_FREE_ZEN_MODEL_SET.has(normalized)
  )
}

/**
 * 读取 settings.json 中的 OpenCode 模型自定义项，并归一化为对象列表。
 */
function getConfiguredOpenCodeModels(
  plan: OpenCodePlan,
): OpenCodeModelDefinition[] {
  const configured = getInitialSettings().opencodeModels?.[plan] ?? []
  return dedupeOpenCodeModels(
    configured
      .map(normalizeConfiguredOpenCodeModel)
      .filter(
        (model): model is OpenCodeModelDefinition =>
          model !== null &&
          (model.protocol ?? inferOpenCodeProtocol(plan, model.id)) !== undefined,
      )
      .map(model => ({
        ...model,
        protocol: model.protocol ?? inferOpenCodeProtocol(plan, model.id),
      })),
  )
}

/**
 * 获取用户可见的 OpenCode Zen 模型目录。
 */
export function getOpenCodeZenModelCatalog(): OpenCodeModelDefinition[] {
  const cached = getGlobalConfig().openCodeZenModelCatalogCache ?? []
  const configured = getConfiguredOpenCodeModels('zen')
  return dedupeOpenCodeModels([...cached, ...configured])
}

/**
 * 获取用户可见的 OpenCode Go 模型目录。
 */
export function getOpenCodeGoModelCatalog(): OpenCodeModelDefinition[] {
  const configured = getConfiguredOpenCodeModels('go')
  return dedupeOpenCodeModels([
    ...DEFAULT_OPENCODE_GO_MODEL_DEFINITIONS,
    ...configured,
  ])
}

/**
 * 查询某个 OpenCode 模型是否存在用户声明的协议覆盖。
 */
export function getConfiguredOpenCodeProtocol(
  plan: OpenCodePlan,
  modelId: string,
): OpenCodeProtocol | undefined {
  const normalized = modelId.trim().toLowerCase()
  const configured = getConfiguredOpenCodeModels(plan).find(
    model => model.id.toLowerCase() === normalized,
  )
  return configured?.protocol
}

/**
 * 拉取 OpenCode Zen 的模型目录，并缓存到全局配置中。
 */
export async function prefetchOpenCodeZenModelCatalog(): Promise<void> {
  if (getAPIProvider() !== 'opencode') {
    return
  }

  const baseUrl = process.env.OPENCODE_BASE_URL || DEFAULT_OPENCODE_BASE_URL
  const endpoint = new URL('models', ensureTrailingSlash(baseUrl)).toString()
  try {
    logForDebugging(`[OpenCode] Fetching model catalog from ${endpoint}`)
    const response = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
        ...(process.env.OPENCODE_API_KEY
          ? { Authorization: `Bearer ${process.env.OPENCODE_API_KEY}` }
          : {}),
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const payload = (await response.json()) as {
      data?: Array<{ id?: string; object?: string }>
    }
    const models = dedupeOpenCodeModels(
      (payload.data ?? [])
        .map(item => item.id)
        .filter((id): id is string => typeof id === 'string')
        .filter(id => isOpenCodeZenFreeModel(id))
        .map(id => ({
          id,
          protocol: inferOpenCodeProtocol('zen', id),
        }))
        .filter(
          (model): model is OpenCodeModelDefinition =>
            model.protocol !== undefined,
        ),
    )

    if (
      isEqual(getGlobalConfig().openCodeZenModelCatalogCache ?? [], models)
    ) {
      logForDebugging('[OpenCode] Model catalog unchanged, skipping write')
      return
    }

    saveGlobalConfig(current => ({
      ...current,
      openCodeZenModelCatalogCache: models,
    }))
  } catch (error) {
    logError(error)
  }
}

/**
 * 把 settings 中的 OpenCode 模型项规范化为统一结构。
 */
function normalizeConfiguredOpenCodeModel(
  entry: OpenCodeConfiguredModelEntry,
): OpenCodeModelDefinition | null {
  if (typeof entry === 'string') {
    const id = entry.trim()
    return id ? { id } : null
  }

  const id = entry.id.trim()
  if (!id) {
    return null
  }

  return {
    id,
    name: entry.name?.trim() || undefined,
    description: entry.description?.trim() || undefined,
    protocol: entry.protocol,
  }
}

/**
 * 以模型 ID 归并多来源目录项，后出现的定义覆盖先前定义。
 */
function dedupeOpenCodeModels(
  models: OpenCodeModelDefinition[],
): OpenCodeModelDefinition[] {
  const deduped = new Map<string, OpenCodeModelDefinition>()
  for (const model of models) {
    const key = model.id.trim().toLowerCase()
    if (!key) {
      continue
    }
    if (deduped.has(key)) {
      deduped.delete(key)
    }
    deduped.set(key, model)
  }
  return Array.from(deduped.values())
}

/**
 * 确保 URL 能安全地拼接相对路径片段。
 */
function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}
