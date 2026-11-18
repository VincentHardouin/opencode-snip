import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { SnipPlugin, rewrite, toolExecuteBefore, unquoteLauncher } from "./index"

// Same probe as the plugin startup: an old snip without `hook` skips these tests.
const hasSnipHook = (await rewrite("git status")) !== undefined

// The launcher is unquoted when its path has no whitespace because OpenCode's
// `cmd` shell escapes double quotes on Windows.
const SNIP_RUN = /^"?[^"\s]*snip(\.exe)?"? run -- /

describe("toolExecuteBefore", () => {
  async function run(command: string, tool = "shell") {
    const event: { tool: string; input: unknown } = { tool, input: { command } }
    await toolExecuteBefore(event)
    return (event.input as { command: string }).command
  }

  it("should not modify non-shell tool calls", async () => {
    expect(await run("git status", "read")).toBe("git status")
  })

  describe.skipIf(!hasSnipHook)("with snip", () => {
    it("should wrap a command snip has a filter for", async () => {
      const command = await run("git status")
      expect(command).toMatch(SNIP_RUN)
      expect(command).toMatch(/ run -- git status$/)
    })

    it("should keep env var prefixes before snip", async () => {
      expect(await run("CGO_ENABLED=0 go test ./...")).toMatch(/^CGO_ENABLED=0 "?[^"\s]*"? run -- go test \.\/\.\.\.$/)
    })

    it("should wrap each segment of a compound command", async () => {
      expect(await run("git status && git log -5")).toMatch(/ run -- git status && "?[^"\s]*"? run -- git log -5$/)
    })

    it("should not double wrap an already wrapped command", async () => {
      const wrapped = await run("git status")
      expect(await run(wrapped)).toBe(wrapped)
    })

    it.each([
      ["shell builtin", "cd /tmp"],
      ["command without filter", "echo hello"],
      ["head feeding a pipe", "git log | head"],
      ["head feeding a redirect", "go test ./... > out.txt"],
      ["command substitution", "git log $(git rev-parse HEAD)"],
      ["heredoc", "cat <<EOF\ngit status\nEOF"],
    ])("should leave %s untouched", async (_, command) => {
      expect(await run(command)).toBe(command)
    })
  })

  describe("when snip is not reachable", () => {
    const path = process.env.PATH

    beforeEach(() => {
      process.env.PATH = ""
      vi.spyOn(console, "warn").mockImplementation(() => {})
    })

    afterEach(() => {
      process.env.PATH = path
      vi.restoreAllMocks()
    })

    it("should leave the command untouched", async () => {
      expect(await run("git status")).toBe("git status")
    })

    it("should disable the plugin", async () => {
      const hook = vi.fn()
      await SnipPlugin.setup({ tool: { hook } } as unknown as Parameters<typeof SnipPlugin.setup>[0])
      expect(hook).not.toHaveBeenCalled()
    })
  })
})

describe("unquoteLauncher", () => {
  it("should unquote a launcher path without whitespace", () => {
    expect(unquoteLauncher('"C:\\tools\\snip.exe" run -- git status')).toBe("C:\\tools\\snip.exe run -- git status")
  })

  it("should keep the quotes when the path contains whitespace", () => {
    const command = '"C:\\Program Files\\snip.exe" run -- git status'
    expect(unquoteLauncher(command)).toBe(command)
  })

  it("should keep the quotes when the path contains cmd metacharacters", () => {
    const command = '"C:\\tools&more\\snip.exe" run -- git status'
    expect(unquoteLauncher(command)).toBe(command)
  })

  it("should unquote every segment of a compound command", () => {
    expect(unquoteLauncher('"/usr/local/bin/snip" run -- git status && "/usr/local/bin/snip" run -- git log')).toBe(
      "/usr/local/bin/snip run -- git status && /usr/local/bin/snip run -- git log",
    )
  })

  it("should leave commands that are not snip wrappers untouched", () => {
    expect(unquoteLauncher('echo "hello world"')).toBe('echo "hello world"')
  })
})
