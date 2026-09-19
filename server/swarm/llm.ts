import type { SwarmEnv } from './types.ts'

/**
 * Thin, provider-specific adapter for the OpenAI Responses API.
 *
 * Two entry points:
 *  - `structured` : one call, strict JSON schema output.
 *  - `agentLoop`  : a bounded tool-use loop. The model may call registered tools;
 *                   each call is executed by the caller-supplied executor and the
 *                   result is fed back with `previous_response_id`. Ends with a
 *                   strict JSON answer.
 *
 * Every function returns `null` when the provider is unavailable so callers can
 * fall back to deterministic behaviour instead of failing the demo.
 */

export interface JsonSchema { name: string; schema: Record<string, unknown> }

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

interface OutputItem {
  type: string
  id?: string
  call_id?: string
  name?: string
  arguments?: string
  content?: Array<{ type?: string; text?: string }>
}

interface ResponsesPayload { id: string; output?: OutputItem[]; output_text?: string }

const ENDPOINT = 'https://api.openai.com/v1/responses'

export function llmAvailable(env: SwarmEnv) { return Boolean(env.OPENAI_API_KEY) }

async function call(env: SwarmEnv, body: Record<string, unknown>): Promise<ResponsesPayload | null> {
  if (!env.OPENAI_API_KEY) return null
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env.OPENAI_MODEL ?? 'gpt-5-mini', ...body }),
  })
  if (!response.ok) return null
  return response.json() as Promise<ResponsesPayload>
}

function textOf(payload: ResponsesPayload) {
  if (payload.output_text) return payload.output_text
  return (payload.output ?? []).filter((item) => item.type === 'message').flatMap((item) => item.content ?? []).map((content) => content.text ?? '').join('')
}

function format(schema: JsonSchema) {
  return { format: { type: 'json_schema', name: schema.name, strict: true, schema: schema.schema } }
}

export async function structured<T>(env: SwarmEnv, input: { instructions: string; input: string; schema: JsonSchema }): Promise<T | null> {
  const payload = await call(env, { instructions: input.instructions, input: input.input, text: format(input.schema) })
  if (!payload) return null
  try { return JSON.parse(textOf(payload) || 'null') as T } catch { return null }
}

export interface AgentLoopInput<T> {
  instructions: string
  input: string
  tools: ToolSpec[]
  schema: JsonSchema
  maxToolCalls?: number
  execute: (name: string, args: Record<string, unknown>) => Promise<unknown>
  validate?: (value: unknown) => value is T
}

export interface AgentLoopResult<T> { value: T; toolCallsMade: number }

export async function agentLoop<T>(env: SwarmEnv, input: AgentLoopInput<T>): Promise<AgentLoopResult<T> | null> {
  const tools = input.tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: true }))
  let payload = await call(env, { instructions: input.instructions, input: input.input, tools, tool_choice: 'auto', text: format(input.schema) })
  if (!payload) return null

  let toolCallsMade = 0
  const budget = input.maxToolCalls ?? 3
  for (let round = 0; round < budget + 1; round += 1) {
    const calls = (payload.output ?? []).filter((item) => item.type === 'function_call' && item.call_id && item.name)
    if (!calls.length) break
    const outputs: Array<{ type: 'function_call_output'; call_id: string; output: string }> = []
    for (const item of calls) {
      let result: unknown
      if (toolCallsMade >= budget) result = { error: 'Tool budget exhausted. Answer with what you have.' }
      else {
        toolCallsMade += 1
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(item.arguments || '{}') } catch { args = {} }
        try { result = await input.execute(item.name!, args) } catch (error) { result = { error: error instanceof Error ? error.message : 'tool failed' } }
      }
      outputs.push({ type: 'function_call_output', call_id: item.call_id!, output: JSON.stringify(result ?? null) })
    }
    payload = await call(env, { previous_response_id: payload.id, input: outputs, tools, tool_choice: toolCallsMade >= budget ? 'none' : 'auto', text: format(input.schema) })
    if (!payload) return null
  }

  try {
    const value = JSON.parse(textOf(payload) || 'null')
    if (value === null || (input.validate && !input.validate(value))) return null
    return { value: value as T, toolCallsMade }
  } catch { return null }
}
