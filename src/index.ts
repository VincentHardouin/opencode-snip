import type { Hooks, Plugin } from "@opencode-ai/plugin"

const ENV_VAR_RE = /^([A-Za-z_][A-Za-z0-9_]*=[^\s]* +)*/
const UNPROXYABLE_COMMANDS = new Set([
  "cd", "source", ".", "export", "alias", "unset", "set", "shopt", "eval", "exec",
])

export const toolExecuteBefore: NonNullable<Hooks["tool.execute.before"]> = async (input, output) => {
  if (input.tool !== "bash") return

  const command = output.args.command
  if (!command || typeof command !== "string") return
  if (command.startsWith("snip ")) return

  // Split at first shell operator (space + && | ; | &), keeping operator+rest intact
  const splitMatch = command.match(/^(.*?)( &&| [|]| ;|;)(.*)$/)
  const firstPart = splitMatch ? splitMatch[1] : command
  const rest = splitMatch ? splitMatch[2] + splitMatch[3] : ""

  // Extract leading env var prefix (e.g. "CGO_ENABLED=0 GOOS=linux ")
  const envPrefix = (firstPart.match(ENV_VAR_RE) ?? [""])[0]
  const bareCmd = firstPart.slice(envPrefix.length).trim()

  if (UNPROXYABLE_COMMANDS.has(bareCmd.split(/\s+/)[0])) return

  output.args.command = `${envPrefix}snip ${bareCmd}${rest}`
}

export const SnipPlugin: Plugin = async () => {
  return {
    "tool.execute.before": toolExecuteBefore,
  }
}

export default SnipPlugin
