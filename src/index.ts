import type { Hooks, Plugin } from "@opencode-ai/plugin"

const ENV_VAR_RE = /^([A-Za-z_][A-Za-z0-9_]*=[^\s]* +)*/
const UNPROXYABLE_COMMANDS = new Set([
  "cd", "source", ".", "export", "alias", "unset", "set", "shopt", "eval", "exec",
])
const OPERATOR_RE = /(\s*(?:&&|\|\||;)\s*|\s&\s?)/

function findFirstPipe(command: string): number {
  let inSingleQuote = false
  let inDoubleQuote = false
  
  for (let i = 0; i < command.length; i++) {
    const char = command[i]
    
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
    } else if (char === '|' && !inSingleQuote && !inDoubleQuote) {
      if (command[i + 1] === '|' || (i > 0 && command[i - 1] === '|')) {
        i++
        continue
      }
      return i
    }
  }
  
  return -1
}

function stripSnipPrefixes(cmd: string): string {
  let s = cmd.trimStart()
  while (s.startsWith("snip ")) {
    s = s.slice(5).trimStart()
  }
  return s
}

function snipCommand(command: string): string {
  const envPrefix = (command.match(ENV_VAR_RE) ?? [""])[0]
  const bareCmd = stripSnipPrefixes(command.slice(envPrefix.length).trim())
  if (!bareCmd) return command
  if (UNPROXYABLE_COMMANDS.has(bareCmd.split(/\s+/)[0])) return command
  return `${envPrefix}snip ${bareCmd}`
}

export const toolExecuteBefore: NonNullable<Hooks["tool.execute.before"]> = async (input, output) => {
  if (input.tool !== "bash") return

  const command = output.args.command
  if (!command || typeof command !== "string") return

  if (findFirstPipe(command) !== -1) {
    const pipeIdx = findFirstPipe(command)
    const firstCmd = command.slice(0, pipeIdx).trimEnd()
    const rest = command.slice(pipeIdx)
    output.args.command = snipCommand(firstCmd) + ' ' + rest
    return
  }

  const segments = command.split(OPERATOR_RE)

  if (segments.length === 1) {
    output.args.command = snipCommand(command)
    return
  }

  output.args.command = segments
    .map((segment) => OPERATOR_RE.test(segment) ? segment : snipCommand(segment))
    .join("")
}

export const SnipPlugin: Plugin = async ({ $ }) => {
  try {
    await $`which snip`.quiet()
  } catch {
    console.warn("[snip] snip binary not found in PATH — plugin disabled")
    return {}
  }

  return {
    "tool.execute.before": toolExecuteBefore,
  }
}

export default SnipPlugin