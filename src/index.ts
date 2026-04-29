import type { Hooks, Plugin } from "@opencode-ai/plugin"

const ENV_VAR_RE = /^([A-Za-z_][A-Za-z0-9_]*=[^\s]* +)*/
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

async function snipCommand(command: string, shouldWrap: (cmd: string) => Promise<boolean>): Promise<string> {
  const envPrefix = (command.match(ENV_VAR_RE) ?? [""])[0]
  const bareCmd = command.slice(envPrefix.length).trim()
  if (!bareCmd) return command
  if (await shouldWrap(bareCmd)) {
    return `${envPrefix}snip run -- ${bareCmd}`
  }
  return command
}

export function createToolExecuteBefore(shouldWrap: (cmd: string) => Promise<boolean>) {
  return async (input: Parameters<NonNullable<Hooks["tool.execute.before"]>>[0], output: Parameters<NonNullable<Hooks["tool.execute.before"]>>[1]) => {
    try {
      if (input.tool !== "bash") return

      const command = output.args.command
      if (!command || typeof command !== "string") return
      if (command.startsWith("snip ")) return

      const pipeIdx = findFirstPipe(command)
      if (pipeIdx !== -1) {
        const firstCmd = command.slice(0, pipeIdx).trimEnd()
        const rest = command.slice(pipeIdx)
        output.args.command = (await snipCommand(firstCmd, shouldWrap)) + ' ' + rest
        return
      }

      const segments = command.split(OPERATOR_RE)

      if (segments.length === 1) {
        output.args.command = await snipCommand(command, shouldWrap)
        return
      }

      const processed = await Promise.all(
        segments.map((segment) =>
          OPERATOR_RE.test(segment) ? Promise.resolve(segment) : snipCommand(segment, shouldWrap)
        )
      )
      output.args.command = processed.join("")
    } catch {
      // leave command unmodified on any unexpected error
    }
  }
}

export const SnipPlugin: Plugin = async ({ $, client }) => {
  try {
    await $`which snip`.quiet()
  } catch {
    await client.log({ level: "warn", message: "[snip] snip binary not found in PATH — plugin disabled" }).catch(() => {})
    return {}
  }

  const shouldWrap = async (cmd: string): Promise<boolean> => {
    try {
      const result = await $`snip check -- ${{raw: cmd}}`.nothrow().quiet()
      return result.exitCode === 0
    } catch (err) {
      await client.log({ level: "warn", message: `[snip] snip check failed for ${cmd}`, extra: { error: String(err) } }).catch(() => {})
      return false
    }
  }

  return {
    "tool.execute.before": createToolExecuteBefore(shouldWrap),
  }
}

export default SnipPlugin