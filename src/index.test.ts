import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const mockedExecFile = vi.hoisted(() => vi.fn())
const originalExecFile = vi.hoisted(() => ({ current: undefined as ((...args: never[]) => unknown) | undefined }))
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  originalExecFile.current = actual.execFile as (...args: never[]) => unknown
  mockedExecFile.mockImplementation(actual.execFile)
  return { ...actual, execFile: mockedExecFile }
})

import { SnipPlugin, rewrite, shellCreateBefore } from "./index"

const hasSnipHook = (await rewrite("git status", "bash")) !== undefined
mockedExecFile.mockClear()
const SNIP_RUN = /^"[^"]*snip(\.exe)?" run -- /

describe("shellCreateBefore", () => {
  async function run(command: string, shell = "bash") {
    const event = { command, shell }
    await shellCreateBefore(event)
    return event.command
  }

  describe.skipIf(!hasSnipHook)("with snip", () => {
    it("wraps commands with a filter", async () => {
      const command = await run("git status")
      expect(command).toMatch(SNIP_RUN)
      expect(command).toMatch(/ run -- git status$/)
    })
    it("keeps env var prefixes before snip", async () => {
      expect(await run("CGO_ENABLED=0 go test ./...")).toMatch(/^CGO_ENABLED=0 "[^"]*" run -- go test \.\/\.\.\.$/)
    })
    it.each([["&&", "&&"], ["||", "\\|\\|"], [";", ";"]])("wraps both segments with %s", async (operator, escapedOperator) => {
      expect(await run(`git status ${operator} git log -5`)).toMatch(new RegExp(` run -- git status ${escapedOperator} "[^"]*" run -- git log -5$`))
    })
    it("does not double wrap", async () => {
      const wrapped = await run("git status")
      expect(await run(wrapped)).toBe(wrapped)
    })
    it.each([
      ["shell builtin", "cd /tmp"],
      ["command without filter", "echo hello"],
      ["pipe", "git log | head"],
      ["redirect", "go test ./... > out.txt"],
      ["substitution", "git log $(git rev-parse HEAD)"],
      ["heredoc", "cat <<EOF\ngit status\nEOF"],
    ])("leaves %s untouched", async (_, command) => {
      expect(await run(command as string)).toBe(command)
    })
  })

  describe("mocked hook", () => {
    it("registers the shell create.before hook and mutates its command", async () => {
      const registration = { dispose: vi.fn() }
      const hook = vi.fn(async (_name: string, callback: (event: { command: string; shell: string }) => Promise<void>) => {
        const event = { command: "git status", shell: "pwsh.exe" }
        await callback(event)
        expect(event.command).toBe("snip run -- git status && snip run -- git log")
        return registration
      })
      const cleanup = await SnipPlugin.setup({ shell: { hook } } as unknown as Parameters<typeof SnipPlugin.setup>[0])
      expect(hook).toHaveBeenCalledWith("create.before", expect.any(Function))
      await cleanup?.()
      expect(registration.dispose).toHaveBeenCalled()
    })
    it("preserves an event with no command", async () => {
      const event = { command: "", shell: "bash" }
      await shellCreateBefore(event)
      expect(event).toEqual({ command: "", shell: "bash" })
    })
    beforeEach(() => {
      mockedExecFile.mockReset()
      mockedExecFile.mockImplementation((_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
        callback(null, JSON.stringify({ hookSpecificOutput: { updatedInput: { command: '"C:\\\\Program Files\\\\snip.exe" run -- git status && "C:\\\\Tools\\\\snip" run -- git log' } } }))
        return { stdin: { on() {}, end() {} } }
      })
    })
    afterEach(() => {
      mockedExecFile.mockReset()
      // The mock implementation delegates to the actual function outside this suite.
      if (originalExecFile.current) mockedExecFile.mockImplementation(originalExecFile.current)
    })

    it("normalizes doubled-backslash paths and spaces across compound operators", async () => {
      for (const operator of ["&&", "||", ";"]) {
        const source = `"C:\\\\Program Files\\\\snip.exe" run -- git status ${operator} "C:\\\\Tools\\\\snip" run -- git log`
        mockedExecFile.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
          callback(null, JSON.stringify({ hookSpecificOutput: { updatedInput: { command: source } } }))
          return { stdin: { on() {}, end() {} } }
        })
        expect(await rewrite("git status", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe(`snip run -- git status ${operator} snip run -- git log`)
      }
      expect(mockedExecFile).toHaveBeenCalledTimes(3)
      expect(mockedExecFile).toHaveBeenCalledWith("snip", ["hook"], { timeout: 2000 }, expect.any(Function))
    })
    it("preserves env prefixes, unrelated quotes and backslashes; does not match my-snip.exe", async () => {
      const source = String.raw`CGO_ENABLED=0 "C:\\Tools\\snip.exe" run -- go test ./... --label="a\\b"; "C:\\bin\\my-snip.exe" run -- literal`
      mockedExecFile.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
        callback(null, JSON.stringify({ hookSpecificOutput: { updatedInput: { command: source } } }))
        return { stdin: { on() {}, end() {} } }
      })
      expect(await rewrite("CGO_ENABLED=0 go test ./... --label=\"a\\b\"; my-snip.exe run -- literal", "pwsh.exe")).toBe(String.raw`CGO_ENABLED=0 snip run -- go test ./... --label="a\\b"; "C:\\bin\\my-snip.exe" run -- literal`)
    })
    it("leaves wrapper-looking original arguments unchanged", async () => {
      const original = String.raw`echo "C:\\Tools\\snip.exe" run -- text`
      const event = { command: original, shell: "powershell" }
      await shellCreateBefore(event)
      expect(event.command).toBe(original)
    })
    it.each(["bash", "cmd.exe", "C:\\Windows\\System32\\cmd.exe"]) ("does not normalize for %s", async (shell) => {
      mockedExecFile.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
        callback(null, JSON.stringify({ hookSpecificOutput: { updatedInput: { command: '"C:\\snip.exe" run -- git status' } } }))
        return { stdin: { on() {}, end() {} } }
      })
      expect(await rewrite("git status", shell)).toBe('"C:\\snip.exe" run -- git status')
    })
    it.each(["pwsh", "pwsh.exe", "C:/Program Files/PowerShell/7/pwsh.exe", "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\PowerShell.EXE"])("normalizes for PowerShell shell %s", async (shell) => {
      mockedExecFile.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
        callback(null, JSON.stringify({ hookSpecificOutput: { updatedInput: { command: '"C:\\snip.exe" run -- git status' } } }))
        return { stdin: { on() {}, end() {} } }
      })
      expect(await rewrite("git status", shell)).toBe("snip run -- git status")
    })
    it.each([
      ["malformed JSON", null, "not-json"],
      ["process error", new Error("failed"), JSON.stringify({ hookSpecificOutput: { updatedInput: { command: "changed" } } })],
      ["empty stdout", null, "   "],
      ["non-string command", null, JSON.stringify({ hookSpecificOutput: { updatedInput: { command: 42 } } })],
    ])("falls back on %s", async (_label, error, stdout) => {
      mockedExecFile.mockImplementationOnce((_file: string, _args: string[], _options: unknown, callback: (error: Error | null, stdout: string) => void) => {
        callback(error as Error | null, stdout as string)
        return { stdin: { on() {}, end() {} } }
      })
      expect(await rewrite("git status", "bash")).toBeUndefined()
    })
  })

  describe("when snip is not reachable", () => {
    const path = process.env.PATH
    beforeEach(() => {
      process.env.PATH = ""
      mockedExecFile.mockImplementation(originalExecFile.current as (...args: never[]) => unknown)
      vi.spyOn(console, "warn").mockImplementation(() => {})
    })
    afterEach(() => {
      process.env.PATH = path
      vi.restoreAllMocks()
    })
    it("leaves command untouched", async () => {
      expect(await run("git status")).toBe("git status")
    })
    it("disables plugin", async () => {
      const hook = vi.fn()
      await SnipPlugin.setup({ shell: { hook } } as unknown as Parameters<typeof SnipPlugin.setup>[0])
      expect(hook).not.toHaveBeenCalled()
    })
  })
})
