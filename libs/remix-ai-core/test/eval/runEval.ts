/**
 * Model eval runner — a developer tool, not a CI test.
 *
 * Runs EVAL_CASES against one or more models and reports tool-call success
 * rate, answer accuracy, latency and token usage side by side, so choosing a
 * default (or a code-generation fallback) is a measurement rather than a guess.
 *
 * Needs real credentials. Talking to the Remix proxy requires a browser
 * session, so this runs BYOK against the provider directly:
 *
 *   OPENROUTER_API_KEY=sk-or-... \
 *   npx ts-node -T --compiler-options '{"module":"commonjs","moduleResolution":"node","esModuleInterop":true,"target":"es2020"}' \
 *     -r tsconfig-paths/register libs/remix-ai-core/test/eval/runEval.ts \
 *     anthropic/claude-sonnet-5 openai/gpt-5
 */

import { HumanMessage } from '@langchain/core/messages'
import { createModelInstance } from '../../src/inferencers/deepagent/ModelFactory'
import { ModelSelection } from '../../src/types/deepagent'
import { EVAL_CASES, EVAL_TOOLS, EvalCase } from './suite'

interface CaseResult {
  id: string
  passed: boolean
  detail: string
  latencyMs: number
  inputTokens: number
  outputTokens: number
}

interface ModelResult {
  label: string
  results: CaseResult[]
}

function readUsage(message: any): { inputTokens: number; outputTokens: number } {
  const usage = message?.usage_metadata ?? message?.response_metadata?.usage ?? {}
  return {
    inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
    outputTokens: usage.output_tokens ?? usage.completion_tokens ?? 0
  }
}

function textOf(message: any): string {
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((b: any) => (typeof b === 'string' ? b : b?.text ?? '')).join('')
  }
  return ''
}

function grade(testCase: EvalCase, message: any): { passed: boolean; detail: string } {
  const toolCalls: any[] = message?.tool_calls ?? []

  if (testCase.expectTool) {
    const called = toolCalls.map((tc) => tc?.name).filter(Boolean)
    const passed = called.includes(testCase.expectTool)
    return { passed, detail: passed ? `called ${testCase.expectTool}` : `expected ${testCase.expectTool}, got [${called.join(', ') || 'none'}]` }
  }

  const text = textOf(message).toLowerCase()
  const missing = (testCase.expectText ?? []).filter((needle) => !text.includes(needle.toLowerCase()))
  if (toolCalls.length > 0) {
    return { passed: false, detail: `called a tool when none was needed (${toolCalls.map((tc) => tc?.name).join(', ')})` }
  }
  return {
    passed: missing.length === 0,
    detail: missing.length === 0 ? 'text matched' : `missing: ${missing.join(', ')}`
  }
}

async function runModel(selection: ModelSelection): Promise<ModelResult> {
  const label = `${selection.routeProvider ?? selection.provider}/${selection.modelId}`
  const userApiKeys = {
    useOwnKeys: true,
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    bedrockBearerToken: process.env.AWS_BEARER_TOKEN_BEDROCK
  }

  const model = await createModelInstance(selection, undefined, userApiKeys, { fresh: true })
  const withTools = typeof (model as any).bindTools === 'function'
    ? (model as any).bindTools(EVAL_TOOLS)
    : model

  const results: CaseResult[] = []
  for (const testCase of EVAL_CASES) {
    const startedAt = Date.now()
    try {
      const message = await withTools.invoke([new HumanMessage(testCase.prompt)])
      const { inputTokens, outputTokens } = readUsage(message)
      const { passed, detail } = grade(testCase, message)
      results.push({ id: testCase.id, passed, detail, latencyMs: Date.now() - startedAt, inputTokens, outputTokens })
    } catch (error: any) {
      results.push({
        id: testCase.id,
        passed: false,
        detail: `threw: ${error?.message ?? error}`,
        latencyMs: Date.now() - startedAt,
        inputTokens: 0,
        outputTokens: 0
      })
    }
  }
  return { label, results }
}

/**
 * `anthropic/claude-sonnet-5` → an OpenRouter-routed selection. The vendor
 * prefix is the display brand; OpenRouter is always the transport here.
 */
function parseArg(arg: string): ModelSelection {
  const [vendor] = arg.split('/')
  return {
    provider: (arg.includes('/') ? vendor : 'openrouter') as ModelSelection['provider'],
    modelId: arg,
    routeProvider: 'openrouter'
  }
}

function report(all: ModelResult[]): void {
  for (const { label, results } of all) {
    const passed = results.filter((r) => r.passed).length
    const latency = Math.round(results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length)
    const tokensIn = results.reduce((sum, r) => sum + r.inputTokens, 0)
    const tokensOut = results.reduce((sum, r) => sum + r.outputTokens, 0)

    console.log(`\n${label}`)
    console.log(`  ${passed}/${results.length} passed | avg ${latency}ms | ${tokensIn} in / ${tokensOut} out`)
    for (const r of results) {
      console.log(`  ${r.passed ? 'PASS' : 'FAIL'} ${r.id.padEnd(22)} ${r.latencyMs}ms  ${r.detail}`)
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    console.error('usage: runEval.ts <model-id> [<model-id> ...]   (e.g. anthropic/claude-sonnet-5)')
    process.exit(1)
  }
  if (!process.env.OPENROUTER_API_KEY && !process.env.AWS_BEARER_TOKEN_BEDROCK) {
    console.error('no provider key found — set OPENROUTER_API_KEY or AWS_BEARER_TOKEN_BEDROCK')
    process.exit(1)
  }

  const all: ModelResult[] = []
  for (const arg of args) {
    all.push(await runModel(parseArg(arg)))
  }
  report(all)

  const anyFailed = all.some((m) => m.results.some((r) => !r.passed))
  process.exit(anyFailed ? 1 : 0)
}

if (require.main === module) {
  void main()
}
