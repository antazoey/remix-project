/**
 * Model evaluation suite.
 *
 * The catalogue changes often and every model is driven through the same
 * agent harness, so "which model should be the default / the code-generation
 * fallback" is an empirical question. These cases answer it: each one states
 * a prompt, the tools the model is offered, and what a correct response does.
 *
 * Deliberately small and fast — this is a smoke comparison across models, not
 * a benchmark. Add a case whenever a model ships that fails in a new way.
 */

export interface EvalCase {
  id: string
  prompt: string
  /** Tool the model is expected to call. Undefined → it should answer directly. */
  expectTool?: string
  /** Substrings the final text must contain (case-insensitive). */
  expectText?: string[]
}

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'tool-call-basic',
    prompt: 'Read the file contracts/Storage.sol and tell me what it contains.',
    expectTool: 'read_file'
  },
  {
    id: 'tool-call-arguments',
    prompt: 'Compile the file contracts/Storage.sol.',
    expectTool: 'compile_contract'
  },
  {
    id: 'no-tool-needed',
    prompt: 'In one sentence, what does the Solidity `payable` keyword do?',
    expectText: ['ether']
  },
  {
    id: 'solidity-knowledge',
    prompt: 'Name the vulnerability class that the checks-effects-interactions pattern prevents. Answer with the name only.',
    expectText: ['reentran']
  },
  {
    id: 'code-generation',
    prompt: 'Write a minimal Solidity contract with a single public counter and an increment function. Output only code.',
    expectText: ['pragma solidity', 'function']
  }
]

/** Tool schemas offered to the model — shaped like the real Remix tools. */
export const EVAL_TOOLS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file in the current workspace.',
    schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'compile_contract',
    description: 'Compile a Solidity file and return the compilation result.',
    schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  }
]
