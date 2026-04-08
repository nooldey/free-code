/**
 * OpenCode Fetch 适配器。
 *
 * 该适配器会拦截 Anthropic Messages API 请求，并依据所选模型把请求路由到
 * OpenCode Zen / Go 的对应端点。
 *
 * 支持的目标协议：
 * - Anthropic Messages API（`/messages`）
 * - OpenAI Responses API（`/responses`）
 * - OpenAI 兼容 Chat Completions（`/chat/completions`）
 */

const DEFAULT_OPENCODE_BASE_URL = 'https://opencode.ai/zen/v1'
const DEFAULT_OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1'

const OPENCODE_MODEL_PREFIX = 'opencode/'
const OPENCODE_GO_MODEL_PREFIX = 'opencode-go/'

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

const OPENCODE_ZEN_ANTHROPIC_MODEL_SET: ReadonlySet<string> = new Set([
  'claude-opus-4-6',
  'claude-opus-4-5',
  'claude-opus-4-1',
  'claude-sonnet-4-6',
  'claude-sonnet-4-5',
  'claude-sonnet-4',
  'claude-haiku-4-5',
  'claude-3-5-haiku',
])

const OPENCODE_ZEN_RESPONSE_MODEL_SET: ReadonlySet<string> = new Set<string>(
  OPENCODE_ZEN_RESPONSE_MODELS,
)

const OPENCODE_ZEN_OA_COMPAT_MODEL_SET: ReadonlySet<string> = new Set([
  'minimax-m2.5',
  'minimax-m2.5-free',
  'glm-5.1',
  'glm-5',
  'kimi-k2.5',
  'big-pickle',
  'qwen3.6-plus-free',
  'nemotron-3-super-free',
])

const OPENCODE_GO_ANTHROPIC_MODEL_SET: ReadonlySet<string> = new Set([
  'minimax-m2.7',
  'minimax-m2.5',
])

const OPENCODE_GO_OA_COMPAT_MODEL_SET: ReadonlySet<string> = new Set([
  'glm-5.1',
  'glm-5',
  'kimi-k2.5',
  'mimo-v2-pro',
  'mimo-v2-omni',
])

type OpenCodePlan = 'go' | 'zen'
type OpenCodeProtocol = 'anthropic' | 'oa-compat' | 'responses'

interface AnthropicContentBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | AnthropicContentBlock[]
  source?: {
    type?: string
    media_type?: string
    data?: string
  }
  [key: string]: unknown
}

interface AnthropicMessage {
  role: string
  content: string | AnthropicContentBlock[]
}

interface AnthropicTool {
  name: string
  description?: string
  input_schema?: Record<string, unknown>
}

interface OpenAIFunctionDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

interface OpenAIFunctionTool {
  type: 'function'
  function: OpenAIFunctionDefinition
}

/**
 * 判断给定模型值是否属于 OpenCode 集成范围。
 */
export function isOpenCodeModel(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return (
    normalized.startsWith(OPENCODE_MODEL_PREFIX) ||
    normalized.startsWith(OPENCODE_GO_MODEL_PREFIX) ||
    normalized.startsWith('claude-') ||
    normalized.startsWith('gpt-') ||
    normalized.includes('codex') ||
    OPENCODE_ZEN_OA_COMPAT_MODEL_SET.has(normalized) ||
    OPENCODE_GO_OA_COMPAT_MODEL_SET.has(normalized) ||
    OPENCODE_GO_ANTHROPIC_MODEL_SET.has(normalized)
  )
}

/**
 * 去掉模型字符串中的 OpenCode 逻辑前缀。
 */
export function stripOpenCodeModelPrefix(model: string): string {
  if (model.startsWith(OPENCODE_GO_MODEL_PREFIX)) {
    return model.slice(OPENCODE_GO_MODEL_PREFIX.length)
  }
  if (model.startsWith(OPENCODE_MODEL_PREFIX)) {
    return model.slice(OPENCODE_MODEL_PREFIX.length)
  }
  return model
}

/**
 * 格式化单个 SSE 事件片段。
 */
function formatSSE(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`
}

/**
 * 从 Anthropic 请求体中提取模型选择。
 */
function getRequestedModel(body: Record<string, unknown>): string {
  const model = body.model
  return typeof model === 'string' ? model.trim() : ''
}

/**
 * 解析最终要使用的 OpenCode 套餐、协议、模型 ID 与基础 URL。
 */
function resolveOpenCodeRoute(model: string): {
  baseUrl: string
  model: string
  plan: OpenCodePlan
  protocol: OpenCodeProtocol
} {
  const trimmed = model.trim()
  const normalized = trimmed.toLowerCase()

  let plan: OpenCodePlan = 'zen'
  let effectiveModel = trimmed

  if (normalized.startsWith(OPENCODE_GO_MODEL_PREFIX)) {
    plan = 'go'
    effectiveModel = trimmed.slice(OPENCODE_GO_MODEL_PREFIX.length)
  } else if (normalized.startsWith(OPENCODE_MODEL_PREFIX)) {
    plan = 'zen'
    effectiveModel = trimmed.slice(OPENCODE_MODEL_PREFIX.length)
  } else if (
    OPENCODE_GO_ANTHROPIC_MODEL_SET.has(normalized) ||
    normalized === 'mimo-v2-pro' ||
    normalized === 'mimo-v2-omni'
  ) {
    plan = 'go'
  }

  const effectiveNormalized = effectiveModel.toLowerCase()
  const baseUrl =
    plan === 'go'
      ? process.env.OPENCODE_GO_BASE_URL || DEFAULT_OPENCODE_GO_BASE_URL
      : process.env.OPENCODE_BASE_URL || DEFAULT_OPENCODE_BASE_URL

  if (plan === 'go') {
    if (OPENCODE_GO_ANTHROPIC_MODEL_SET.has(effectiveNormalized)) {
      return { baseUrl, model: effectiveModel, plan, protocol: 'anthropic' }
    }
    return { baseUrl, model: effectiveModel, plan, protocol: 'oa-compat' }
  }

  if (
    OPENCODE_ZEN_ANTHROPIC_MODEL_SET.has(effectiveNormalized) ||
    effectiveNormalized.startsWith('claude-')
  ) {
    return { baseUrl, model: effectiveModel, plan, protocol: 'anthropic' }
  }

  if (
    OPENCODE_ZEN_RESPONSE_MODEL_SET.has(effectiveNormalized) ||
    effectiveNormalized.startsWith('gpt-') ||
    effectiveNormalized.includes('codex')
  ) {
    return { baseUrl, model: effectiveModel, plan, protocol: 'responses' }
  }

  return { baseUrl, model: effectiveModel, plan, protocol: 'oa-compat' }
}

/**
 * 从被拦截的 fetch 输入中解析 Anthropic 请求体。
 */
async function parseAnthropicBody(
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  try {
    const bodyText =
      init?.body instanceof ReadableStream
        ? await new Response(init.body).text()
        : typeof init?.body === 'string'
          ? init.body
          : '{}'
    return JSON.parse(bodyText) as Record<string, unknown>
  } catch {
    return {}
  }
}

/**
 * 把 Anthropic system prompt 负载转换为普通 instructions 字符串。
 */
function getInstructions(
  systemPrompt:
    | string
    | Array<{ type: string; text?: string; cache_control?: unknown }>
    | undefined,
): string {
  if (!systemPrompt) {
    return ''
  }
  if (typeof systemPrompt === 'string') {
    return systemPrompt
  }
  return systemPrompt
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text!)
    .join('\n')
}

/**
 * 把 Anthropic 工具定义转换为 OpenAI 风格的 function tools。
 */
function translateToolsToOpenAI(
  anthropicTools: AnthropicTool[],
): OpenAIFunctionTool[] {
  return anthropicTools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || { type: 'object', properties: {} },
    },
  }))
}

/**
 * 把 Anthropic 消息转换为 OpenAI Responses API 的 input items。
 */
function translateMessagesToResponsesInput(
  anthropicMessages: AnthropicMessage[],
): Array<Record<string, unknown>> {
  const input: Array<Record<string, unknown>> = []
  let toolCallCounter = 0

  for (const msg of anthropicMessages) {
    if (typeof msg.content === 'string') {
      input.push({ role: msg.role, content: msg.content })
      continue
    }

    if (!Array.isArray(msg.content)) {
      continue
    }

    if (msg.role === 'user') {
      const userParts: Array<Record<string, unknown>> = []
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          const callId = block.tool_use_id || `call_${toolCallCounter++}`
          let output = ''
          if (typeof block.content === 'string') {
            output = block.content
          } else if (Array.isArray(block.content)) {
            output = block.content
              .map(item => {
                if (item.type === 'text') return item.text || ''
                if (item.type === 'image') return '[Image data attached]'
                return ''
              })
              .join('\n')
          }
          input.push({
            type: 'function_call_output',
            call_id: callId,
            output,
          })
          continue
        }

        if (block.type === 'text' && typeof block.text === 'string') {
          userParts.push({ type: 'input_text', text: block.text })
          continue
        }

        if (
          block.type === 'image' &&
          typeof block.source === 'object' &&
          block.source !== null &&
          block.source.type === 'base64' &&
          typeof block.source.media_type === 'string' &&
          typeof block.source.data === 'string'
        ) {
          userParts.push({
            type: 'input_image',
            image_url: `data:${block.source.media_type};base64,${block.source.data}`,
          })
        }
      }

      if (userParts.length === 1 && userParts[0].type === 'input_text') {
        input.push({ role: 'user', content: userParts[0].text })
      } else if (userParts.length > 0) {
        input.push({ role: 'user', content: userParts })
      }
      continue
    }

    for (const block of msg.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        input.push({
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: block.text, annotations: [] }],
          status: 'completed',
        })
        continue
      }

      if (block.type === 'tool_use') {
        const callId = block.id || `call_${toolCallCounter++}`
        input.push({
          type: 'function_call',
          call_id: callId,
          name: block.name || '',
          arguments: JSON.stringify(block.input || {}),
        })
      }
    }
  }

  return input
}

/**
 * 把 Anthropic 请求体转换为 OpenAI Responses 请求体。
 */
function translateToResponsesBody(
  anthropicBody: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const anthropicMessages = (anthropicBody.messages || []) as AnthropicMessage[]
  const anthropicTools = (anthropicBody.tools || []) as AnthropicTool[]
  const systemPrompt = anthropicBody.system as
    | string
    | Array<{ type: string; text?: string; cache_control?: unknown }>
    | undefined

  const body: Record<string, unknown> = {
    model,
    store: false,
    stream: true,
    instructions: getInstructions(systemPrompt),
    input: translateMessagesToResponsesInput(anthropicMessages),
  }

  if (anthropicTools.length > 0) {
    body.tools = translateToolsToOpenAI(anthropicTools).map(tool => ({
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
      strict: null,
    }))
    body.tool_choice = 'auto'
    body.parallel_tool_calls = true
  }

  return body
}

/**
 * 把 Anthropic 消息转换为 OpenAI 兼容的 chat messages。
 */
function translateMessagesToOaCompat(
  anthropicMessages: AnthropicMessage[],
  instructions: string,
): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = []

  if (instructions) {
    messages.push({ role: 'system', content: instructions })
  }

  for (const msg of anthropicMessages) {
    if (typeof msg.content === 'string') {
      messages.push({ role: msg.role, content: msg.content })
      continue
    }

    if (!Array.isArray(msg.content)) {
      continue
    }

    if (msg.role === 'user') {
      const content: Array<Record<string, unknown>> = []
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          let output = ''
          if (typeof block.content === 'string') {
            output = block.content
          } else if (Array.isArray(block.content)) {
            output = block.content
              .map(item => {
                if (item.type === 'text') return item.text || ''
                if (item.type === 'image') return '[Image data attached]'
                return ''
              })
              .join('\n')
          }
          messages.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: output,
          })
          continue
        }

        if (block.type === 'text' && typeof block.text === 'string') {
          content.push({ type: 'text', text: block.text })
          continue
        }

        if (
          block.type === 'image' &&
          typeof block.source === 'object' &&
          block.source !== null &&
          block.source.type === 'base64' &&
          typeof block.source.media_type === 'string' &&
          typeof block.source.data === 'string'
        ) {
          content.push({
            type: 'image_url',
            image_url: {
              url: `data:${block.source.media_type};base64,${block.source.data}`,
            },
          })
        }
      }

      if (content.length === 1 && content[0].type === 'text') {
        messages.push({ role: 'user', content: content[0].text })
      } else if (content.length > 0) {
        messages.push({ role: 'user', content })
      }
      continue
    }

    const textParts: string[] = []
    const toolCalls: Array<Record<string, unknown>> = []
    for (const block of msg.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text)
        continue
      }

      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input || {}),
          },
        })
      }
    }

    if (textParts.length === 0 && toolCalls.length === 0) {
      continue
    }

    const assistantMessage: Record<string, unknown> = { role: 'assistant' }
    if (textParts.length > 0) {
      assistantMessage.content = textParts.join('\n')
    }
    if (toolCalls.length > 0) {
      assistantMessage.tool_calls = toolCalls
    }
    messages.push(assistantMessage)
  }

  return messages
}

/**
 * 把 Anthropic 请求体转换为 OpenAI 兼容的 chat completions 请求体。
 */
function translateToOaCompatBody(
  anthropicBody: Record<string, unknown>,
  model: string,
): Record<string, unknown> {
  const anthropicMessages = (anthropicBody.messages || []) as AnthropicMessage[]
  const anthropicTools = (anthropicBody.tools || []) as AnthropicTool[]
  const systemPrompt = anthropicBody.system as
    | string
    | Array<{ type: string; text?: string; cache_control?: unknown }>
    | undefined

  const body: Record<string, unknown> = {
    model,
    stream: true,
    stream_options: { include_usage: true },
    messages: translateMessagesToOaCompat(
      anthropicMessages,
      getInstructions(systemPrompt),
    ),
  }

  if (anthropicBody.max_tokens !== undefined) {
    body.max_tokens = anthropicBody.max_tokens
  }
  if (anthropicBody.temperature !== undefined) {
    body.temperature = anthropicBody.temperature
  }
  if (anthropicBody.top_p !== undefined) {
    body.top_p = anthropicBody.top_p
  }
  if (anthropicBody.stop_sequences !== undefined) {
    body.stop = anthropicBody.stop_sequences
  }

  if (anthropicTools.length > 0) {
    body.tools = translateToolsToOpenAI(anthropicTools)
    body.tool_choice = 'auto'
  }

  return body
}

/**
 * 输出收尾的 Anthropic message delta / stop 事件。
 */
function finishAnthropicStream(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  inputTokens: number,
  outputTokens: number,
  hadToolCalls: boolean,
): void {
  controller.enqueue(
    encoder.encode(
      formatSSE(
        'message_delta',
        JSON.stringify({
          type: 'message_delta',
          delta: {
            stop_reason: hadToolCalls ? 'tool_use' : 'end_turn',
            stop_sequence: null,
          },
          usage: { output_tokens: outputTokens },
        }),
      ),
    ),
  )

  controller.enqueue(
    encoder.encode(
      formatSSE(
        'message_stop',
        JSON.stringify({
          type: 'message_stop',
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
          },
        }),
      ),
    ),
  )

  controller.close()
}

/**
 * 把 OpenAI Responses SSE 流翻译回 Anthropic SSE。
 */
function translateResponsesStreamToAnthropic(
  response: Response,
  model: string,
): Response {
  const messageId = `msg_opencode_${Date.now()}`
  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      let buffer = ''
      let contentBlockIndex = 0
      let inputTokens = 0
      let outputTokens = 0
      let currentTextBlockStarted = false
      let currentToolCallId = ''
      let currentToolCallName = ''
      let currentToolCallArgs = ''
      let inToolCall = false
      let inReasoningBlock = false
      let hadToolCalls = false

      controller.enqueue(
        encoder.encode(
          formatSSE(
            'message_start',
            JSON.stringify({
              type: 'message_start',
              message: {
                id: messageId,
                type: 'message',
                role: 'assistant',
                content: [],
                model,
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 },
              },
            }),
          ),
        ),
      )

      controller.enqueue(
        encoder.encode(formatSSE('ping', JSON.stringify({ type: 'ping' }))),
      )

      const reader = response.body?.getReader()
      if (!reader) {
        finishAnthropicStream(controller, encoder, 0, 0, false)
        return
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (!line || line.startsWith('event: ')) continue
          if (!line.startsWith('data: ')) continue

          const data = line.slice(6)
          if (data === '[DONE]') continue

          let event: Record<string, unknown>
          try {
            event = JSON.parse(data)
          } catch {
            continue
          }

          const eventType = event.type as string

          if (eventType === 'response.output_item.added') {
            const item = event.item as Record<string, unknown>
            if (item?.type === 'reasoning') {
              inReasoningBlock = true
              controller.enqueue(
                encoder.encode(
                  formatSSE(
                    'content_block_start',
                    JSON.stringify({
                      type: 'content_block_start',
                      index: contentBlockIndex,
                      content_block: { type: 'thinking', thinking: '' },
                    }),
                  ),
                ),
              )
              continue
            }

            if (item?.type === 'function_call') {
              if (currentTextBlockStarted) {
                controller.enqueue(
                  encoder.encode(
                    formatSSE(
                      'content_block_stop',
                      JSON.stringify({
                        type: 'content_block_stop',
                        index: contentBlockIndex,
                      }),
                    ),
                  ),
                )
                contentBlockIndex += 1
                currentTextBlockStarted = false
              }

              currentToolCallId = (item.call_id as string) || `toolu_${Date.now()}`
              currentToolCallName = (item.name as string) || ''
              currentToolCallArgs = (item.arguments as string) || ''
              inToolCall = true
              hadToolCalls = true

              controller.enqueue(
                encoder.encode(
                  formatSSE(
                    'content_block_start',
                    JSON.stringify({
                      type: 'content_block_start',
                      index: contentBlockIndex,
                      content_block: {
                        type: 'tool_use',
                        id: currentToolCallId,
                        name: currentToolCallName,
                        input: {},
                      },
                    }),
                  ),
                ),
              )
            }
            continue
          }

          if (eventType === 'response.output_text.delta') {
            const text = event.delta as string
            if (!text) continue

            if (!currentTextBlockStarted) {
              controller.enqueue(
                encoder.encode(
                  formatSSE(
                    'content_block_start',
                    JSON.stringify({
                      type: 'content_block_start',
                      index: contentBlockIndex,
                      content_block: { type: 'text', text: '' },
                    }),
                  ),
                ),
              )
              currentTextBlockStarted = true
            }

            controller.enqueue(
              encoder.encode(
                formatSSE(
                  'content_block_delta',
                  JSON.stringify({
                    type: 'content_block_delta',
                    index: contentBlockIndex,
                    delta: { type: 'text_delta', text },
                  }),
                ),
              ),
            )
            continue
          }

          if (eventType === 'response.reasoning.delta') {
            const text = event.delta as string
            if (!text) continue

            if (!inReasoningBlock) {
              inReasoningBlock = true
              controller.enqueue(
                encoder.encode(
                  formatSSE(
                    'content_block_start',
                    JSON.stringify({
                      type: 'content_block_start',
                      index: contentBlockIndex,
                      content_block: { type: 'thinking', thinking: '' },
                    }),
                  ),
                ),
              )
            }

            controller.enqueue(
              encoder.encode(
                formatSSE(
                  'content_block_delta',
                  JSON.stringify({
                    type: 'content_block_delta',
                    index: contentBlockIndex,
                    delta: { type: 'thinking_delta', thinking: text },
                  }),
                ),
              ),
            )
            continue
          }

          if (eventType === 'response.function_call_arguments.delta') {
            const argDelta = event.delta as string
            if (!inToolCall || !argDelta) continue

            currentToolCallArgs += argDelta
            controller.enqueue(
              encoder.encode(
                formatSSE(
                  'content_block_delta',
                  JSON.stringify({
                    type: 'content_block_delta',
                    index: contentBlockIndex,
                    delta: {
                      type: 'input_json_delta',
                      partial_json: argDelta,
                    },
                  }),
                ),
              ),
            )
            continue
          }

          if (eventType === 'response.function_call_arguments.done') {
            currentToolCallArgs =
              (event.arguments as string) || currentToolCallArgs
            continue
          }

          if (eventType === 'response.output_item.done') {
            const item = event.item as Record<string, unknown>
            if (item?.type === 'function_call' && inToolCall) {
              controller.enqueue(
                encoder.encode(
                  formatSSE(
                    'content_block_stop',
                    JSON.stringify({
                      type: 'content_block_stop',
                      index: contentBlockIndex,
                    }),
                  ),
                ),
              )
              contentBlockIndex += 1
              inToolCall = false
              currentToolCallArgs = ''
              continue
            }

            if (item?.type === 'message' && currentTextBlockStarted) {
              controller.enqueue(
                encoder.encode(
                  formatSSE(
                    'content_block_stop',
                    JSON.stringify({
                      type: 'content_block_stop',
                      index: contentBlockIndex,
                    }),
                  ),
                ),
              )
              contentBlockIndex += 1
              currentTextBlockStarted = false
              continue
            }

            if (item?.type === 'reasoning' && inReasoningBlock) {
              controller.enqueue(
                encoder.encode(
                  formatSSE(
                    'content_block_stop',
                    JSON.stringify({
                      type: 'content_block_stop',
                      index: contentBlockIndex,
                    }),
                  ),
                ),
              )
              contentBlockIndex += 1
              inReasoningBlock = false
            }
            continue
          }

          if (eventType === 'response.completed') {
            const usage = (event.response as Record<string, unknown>)
              ?.usage as Record<string, number> | undefined
            if (usage) {
              inputTokens = usage.input_tokens || inputTokens
              outputTokens = usage.output_tokens || outputTokens
            }
          }
        }
      }

      if (currentTextBlockStarted || inToolCall || inReasoningBlock) {
        controller.enqueue(
          encoder.encode(
            formatSSE(
              'content_block_stop',
              JSON.stringify({
                type: 'content_block_stop',
                index: contentBlockIndex,
              }),
            ),
          ),
        )
      }

      finishAnthropicStream(
        controller,
        encoder,
        inputTokens,
        outputTokens,
        hadToolCalls,
      )
    },
  })

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'x-request-id': messageId,
    },
  })
}

/**
 * 从 OpenAI 兼容 chunk 中提取 reasoning 增量文本。
 */
function getOaCompatReasoningText(
  delta: Record<string, unknown>,
): string | null {
  const reasoningFields = ['reasoning', 'reasoning_content', 'reasoning_text']
  for (const field of reasoningFields) {
    const value = delta[field]
    if (typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return null
}

/**
 * 把 OpenAI 兼容 chat completion SSE 流翻译为 Anthropic SSE。
 */
function translateOaCompatStreamToAnthropic(
  response: Response,
  model: string,
): Response {
  const messageId = `msg_opencode_compat_${Date.now()}`
  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      let buffer = ''
      let contentBlockIndex = 0
      let inputTokens = 0
      let outputTokens = 0
      let currentTextBlockStarted = false
      let inToolCall = false
      let inReasoningBlock = false
      let hadToolCalls = false
      let currentToolCallIndex = -1

      controller.enqueue(
        encoder.encode(
          formatSSE(
            'message_start',
            JSON.stringify({
              type: 'message_start',
              message: {
                id: messageId,
                type: 'message',
                role: 'assistant',
                content: [],
                model,
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: 0, output_tokens: 0 },
              },
            }),
          ),
        ),
      )

      controller.enqueue(
        encoder.encode(formatSSE('ping', JSON.stringify({ type: 'ping' }))),
      )

      const reader = response.body?.getReader()
      if (!reader) {
        finishAnthropicStream(controller, encoder, 0, 0, false)
        return
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n')
        buffer = parts.pop() || ''

        for (const rawLine of parts) {
          const line = rawLine.trim()
          if (!line || !line.startsWith('data: ')) continue

          const payload = line.slice(6)
          if (payload === '[DONE]') continue

          let chunk: Record<string, unknown>
          try {
            chunk = JSON.parse(payload)
          } catch {
            continue
          }

          const usage = chunk.usage as Record<string, unknown> | undefined
          if (usage) {
            inputTokens =
              (usage.prompt_tokens as number | undefined) || inputTokens
            outputTokens =
              (usage.completion_tokens as number | undefined) || outputTokens
          }

          const choices = Array.isArray(chunk.choices)
            ? (chunk.choices as Array<Record<string, unknown>>)
            : []
          const choice = choices[0]
          if (!choice) continue

          const delta = (choice.delta || {}) as Record<string, unknown>
          const finishReason = choice.finish_reason as string | null | undefined

          const reasoningText = getOaCompatReasoningText(delta)
          if (reasoningText) {
            if (!inReasoningBlock) {
              inReasoningBlock = true
              controller.enqueue(
                encoder.encode(
                  formatSSE(
                    'content_block_start',
                    JSON.stringify({
                      type: 'content_block_start',
                      index: contentBlockIndex,
                      content_block: { type: 'thinking', thinking: '' },
                    }),
                  ),
                ),
              )
            }

            controller.enqueue(
              encoder.encode(
                formatSSE(
                  'content_block_delta',
                  JSON.stringify({
                    type: 'content_block_delta',
                    index: contentBlockIndex,
                    delta: {
                      type: 'thinking_delta',
                      thinking: reasoningText,
                    },
                  }),
                ),
              ),
            )
            continue
          }

          const text = delta.content
          if (typeof text === 'string' && text.length > 0) {
            if (!currentTextBlockStarted) {
              controller.enqueue(
                encoder.encode(
                  formatSSE(
                    'content_block_start',
                    JSON.stringify({
                      type: 'content_block_start',
                      index: contentBlockIndex,
                      content_block: { type: 'text', text: '' },
                    }),
                  ),
                ),
              )
              currentTextBlockStarted = true
            }

            controller.enqueue(
              encoder.encode(
                formatSSE(
                  'content_block_delta',
                  JSON.stringify({
                    type: 'content_block_delta',
                    index: contentBlockIndex,
                    delta: { type: 'text_delta', text },
                  }),
                ),
              ),
            )
          }

          const toolCalls = Array.isArray(delta.tool_calls)
            ? (delta.tool_calls as Array<Record<string, unknown>>)
            : []
          for (const toolCall of toolCalls) {
            const index =
              typeof toolCall.index === 'number' ? toolCall.index : 0

            if (currentTextBlockStarted) {
              controller.enqueue(
                encoder.encode(
                  formatSSE(
                    'content_block_stop',
                    JSON.stringify({
                      type: 'content_block_stop',
                      index: contentBlockIndex,
                    }),
                  ),
                ),
              )
              contentBlockIndex += 1
              currentTextBlockStarted = false
            }

            if (!inToolCall || currentToolCallIndex !== index) {
              if (inToolCall) {
                controller.enqueue(
                  encoder.encode(
                    formatSSE(
                      'content_block_stop',
                      JSON.stringify({
                        type: 'content_block_stop',
                        index: contentBlockIndex,
                      }),
                    ),
                  ),
                )
                contentBlockIndex += 1
              }

              const func = (toolCall.function || {}) as Record<string, unknown>
              controller.enqueue(
                encoder.encode(
                  formatSSE(
                    'content_block_start',
                    JSON.stringify({
                      type: 'content_block_start',
                      index: contentBlockIndex,
                      content_block: {
                        type: 'tool_use',
                        id:
                          (toolCall.id as string | undefined) ||
                          `toolu_${Date.now()}`,
                        name: (func.name as string | undefined) || '',
                        input: {},
                      },
                    }),
                  ),
                ),
              )
              inToolCall = true
              hadToolCalls = true
              currentToolCallIndex = index
            }

            const func = (toolCall.function || {}) as Record<string, unknown>
            const argumentsDelta = func.arguments
            if (typeof argumentsDelta === 'string' && argumentsDelta.length > 0) {
              controller.enqueue(
                encoder.encode(
                  formatSSE(
                    'content_block_delta',
                    JSON.stringify({
                      type: 'content_block_delta',
                      index: contentBlockIndex,
                      delta: {
                        type: 'input_json_delta',
                        partial_json: argumentsDelta,
                      },
                    }),
                  ),
                ),
              )
            }
          }

          if (finishReason === 'tool_calls' && inToolCall) {
            controller.enqueue(
              encoder.encode(
                formatSSE(
                  'content_block_stop',
                  JSON.stringify({
                    type: 'content_block_stop',
                    index: contentBlockIndex,
                  }),
                ),
              ),
            )
            contentBlockIndex += 1
            inToolCall = false
            currentToolCallIndex = -1
          }
        }
      }

      if (currentTextBlockStarted || inToolCall || inReasoningBlock) {
        controller.enqueue(
          encoder.encode(
            formatSSE(
              'content_block_stop',
              JSON.stringify({
                type: 'content_block_stop',
                index: contentBlockIndex,
              }),
            ),
          ),
        )
      }

      finishAnthropicStream(
        controller,
        encoder,
        inputTokens,
        outputTokens,
        hadToolCalls,
      )
    },
  })

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'x-request-id': messageId,
    },
  })
}

/**
 * 把兼容的 Anthropic 请求透传到 OpenCode `/messages` 端点。
 */
async function forwardAnthropicRequest(
  url: string,
  init: RequestInit | undefined,
  model: string,
  apiKey: string,
  anthropicBody: Record<string, unknown>,
): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set('x-api-key', apiKey)
  headers.delete('authorization')
  headers.delete('host')
  headers.delete('content-length')

  const body = JSON.stringify({
    ...anthropicBody,
    model,
  })

  return globalThis.fetch(url, {
    ...init,
    method: 'POST',
    headers,
    body,
  })
}

/**
 * 把翻译后的请求发送到 OpenCode 的 OpenAI Responses 端点。
 */
async function fetchResponses(
  url: string,
  model: string,
  apiKey: string,
  anthropicBody: Record<string, unknown>,
): Promise<Response> {
  const response = await globalThis.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(translateToResponsesBody(anthropicBody, model)),
  })

  if (!response.ok) {
    const errorText = await response.text()
    return new Response(
      JSON.stringify({
        type: 'error',
        error: {
          type: 'api_error',
          message: `OpenCode Responses API error (${response.status}): ${errorText}`,
        },
      }),
      {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  return translateResponsesStreamToAnthropic(response, model)
}

/**
 * 把翻译后的请求发送到 OpenCode 的 chat completions 端点。
 */
async function fetchOaCompat(
  url: string,
  model: string,
  apiKey: string,
  anthropicBody: Record<string, unknown>,
): Promise<Response> {
  const response = await globalThis.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(translateToOaCompatBody(anthropicBody, model)),
  })

  if (!response.ok) {
    const errorText = await response.text()
    return new Response(
      JSON.stringify({
        type: 'error',
        error: {
          type: 'api_error',
          message: `OpenCode Chat Completions API error (${response.status}): ${errorText}`,
        },
      }),
      {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }

  return translateOaCompatStreamToAnthropic(response, model)
}

/**
 * 创建一个把 Anthropic SDK 流量路由到 OpenCode 的 fetch override。
 */
export function createOpenCodeFetch(
  apiKey: string,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.includes('/v1/messages')) {
      return globalThis.fetch(input, init)
    }

    const anthropicBody = await parseAnthropicBody(init)
    const requestedModel = getRequestedModel(anthropicBody)
    const route = resolveOpenCodeRoute(requestedModel)

    if (route.protocol === 'anthropic') {
      return forwardAnthropicRequest(
        `${route.baseUrl}/messages`,
        init,
        route.model,
        apiKey,
        anthropicBody,
      )
    }

    if (route.protocol === 'responses') {
      return fetchResponses(
        `${route.baseUrl}/responses`,
        route.model,
        apiKey,
        anthropicBody,
      )
    }

    return fetchOaCompat(
      `${route.baseUrl}/chat/completions`,
      route.model,
      apiKey,
      anthropicBody,
    )
  }
}
