import { describe, it, expect, afterAll, vi } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { SnipPlugin, rewrite, snipBin, readShellConfig, shouldPrefixPS } from "./index"

// Binary discovery control: clearing PATH alone is not enough — a snip.exe next
// to the plugin or at the package root would still be found.
const fsMock = vi.hoisted(() => ({ noLocalSnip: false, forceLocalSnip: false }))
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return {
    ...actual,
    existsSync: (p: any) => {
      if (typeof p !== "string" || !/snip\.exe$/.test(p)) return actual.existsSync(p)
      if (fsMock.forceLocalSnip) return true
      if (fsMock.noLocalSnip) return false
      return actual.existsSync(p)
    },
  }
})

// Same probe as the plugin startup: an old snip without `hook` skips these tests.
const hasSnipHook = (await rewrite("git status")) !== undefined

const DIR = path.dirname(fileURLToPath(import.meta.url))
// Temp project dir: tests never create or delete files in the checkout.
const TMP_PROJECT = fs.mkdtempSync(path.join(os.tmpdir(), "snip-proj-"))
const TEST_CONFIG = path.join(TMP_PROJECT, ".opencode", "opencode.json")

// Pin the configured shell for hook tests so they do not depend on the
// developer's real OpenCode config (project config wins over global).
function pinShell(shell: string | undefined) {
  fs.mkdirSync(path.dirname(TEST_CONFIG), { recursive: true })
  if (shell === undefined) {
    if (fs.existsSync(TEST_CONFIG)) fs.unlinkSync(TEST_CONFIG)
  } else {
    fs.writeFileSync(TEST_CONFIG, JSON.stringify({ shell }))
  }
}

afterAll(() => fs.rmSync(TMP_PROJECT, { recursive: true, force: true }))

// Captures the V2 hook the plugin registers at setup.
async function setupPlugin() {
  const hooks: Record<string, (event: any) => Promise<void>> = {}
  const ctx = {
    location: { directory: TMP_PROJECT },
    tool: {
      hook: async (name: string, cb: (event: any) => Promise<void>) => {
        hooks[`tool.${name}`] = cb
      },
    },
  }
  const result = await SnipPlugin.setup(ctx)
  return { hooks, result }
}

describe("SnipPlugin (V2)", () => {
  describe("when snip is not reachable", () => {
    it("should register no hooks and disable the plugin", async () => {
      const origPath = process.env.PATH
      process.env.PATH = ""
      fsMock.noLocalSnip = true
      vi.spyOn(console, "warn").mockImplementation(() => {})
      try {
        const { hooks, result } = await setupPlugin()
        expect(result).toEqual({})
        expect(Object.keys(hooks)).toHaveLength(0)
      } finally {
        process.env.PATH = origPath
        fsMock.noLocalSnip = false
        vi.restoreAllMocks()
      }
    })
  })

  describe.skipIf(!hasSnipHook)("with snip", () => {
    // Setup here (not beforeEach): pinShell runs in each test body before the
    // first runTool call, and setup() reads the shell config once.
    async function runTool(tool: string, command: string) {
      const { hooks } = await setupPlugin()
      const event = { tool, input: { command } }
      await hooks["tool.execute.before"](event)
      return event.input.command
    }

    it("should not modify non-shell tool calls", async () => {
      pinShell("bash")
      expect(await runTool("read", "git status")).toBe("git status")
    })

    it("should wrap a command snip has a filter for", async () => {
      pinShell("bash")
      const command = await runTool("bash", "git status")
      expect(command).toMatch(/^"[^"]*snip(\.exe)?" run -- /)
      expect(command).toMatch(/ run -- git status$/)
    })

    it("should prefix & when the configured shell is PowerShell", async () => {
      pinShell("powershell.exe")
      expect(await runTool("bash", "git status")).toMatch(/^& "[^"]*" run -- git status$/)
    })

    it("should keep env var prefixes before snip", async () => {
      pinShell("bash")
      expect(await runTool("bash", "CGO_ENABLED=0 go test ./...")).toMatch(
        /^CGO_ENABLED=0 "[^"]*" run -- go test \.\/\.\.\.$/,
      )
    })

    it("should wrap each segment of a compound command", async () => {
      pinShell("bash")
      expect(await runTool("bash", "git status && git log -5")).toMatch(
        / run -- git status && "[^"]*" run -- git log -5$/,
      )
    })

    it("should not double wrap an already wrapped command", async () => {
      pinShell("bash")
      const wrapped = await runTool("bash", "git status")
      expect(await runTool("bash", wrapped)).toBe(wrapped)
    })

    it("should not prefix quoted arguments followed by run", async () => {
      pinShell("powershell.exe")
      const command = await runTool("bash", 'git log -- "README.md" run')
      expect(command).toMatch(/^& "[^"]*" run -- git log -- "README\.md" run$/)
    })

    it("should prefix & for every segment of a || chain in PowerShell", async () => {
      pinShell("powershell.exe")
      const command = await runTool("bash", "git status || git log -5")
      expect(command).toMatch(/^& "[^"]*" run -- git status \|\| & "[^"]*" run -- git log -5$/)
    })

    it.each([
      ["shell builtin", "cd /tmp"],
      ["command without filter", "echo hello"],
      ["head feeding a pipe", "git log | head"],
      ["head feeding a redirect", "go test ./... > out.txt"],
      ["command substitution", "git log $(git rev-parse HEAD)"],
      ["heredoc", "cat <<EOF\ngit status\nEOF"],
    ])("should leave %s untouched", async (_, command) => {
      pinShell("bash")
      expect(await runTool("bash", command)).toBe(command)
    })
  })

  describe("shouldPrefixPS", () => {
    it("should follow the configured shell", () => {
      expect(shouldPrefixPS("powershell.exe", "win32")).toBe(true)
      expect(shouldPrefixPS("pwsh", "linux")).toBe(true)
      expect(shouldPrefixPS("bash", "win32")).toBe(false)
      expect(shouldPrefixPS("bash", "linux")).toBe(false)
    })

    it("should fall back to the platform default", () => {
      expect(shouldPrefixPS(undefined, "win32")).toBe(true)
      expect(shouldPrefixPS(undefined, "linux")).toBe(false)
    })
  })

  describe("readShellConfig", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "snip-cfg-"))
    afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

    it("should read the shell setting", () => {
      const p = path.join(tmp, "a.json")
      fs.writeFileSync(p, JSON.stringify({ shell: "bash" }))
      expect(readShellConfig([p])).toBe("bash")
    })

    it("should handle JSONC comments and trailing commas", () => {
      const p = path.join(tmp, "b.jsonc")
      fs.writeFileSync(p, '{\n  // comment\n  "shell": "pwsh",\n}\n')
      expect(readShellConfig([p])).toBe("pwsh")
    })

    it("should prefer the first hit (project over global)", () => {
      const p1 = path.join(tmp, "p1.json")
      const p2 = path.join(tmp, "p2.json")
      fs.writeFileSync(p1, JSON.stringify({ shell: "bash" }))
      fs.writeFileSync(p2, JSON.stringify({ shell: "pwsh" }))
      expect(readShellConfig([p1, p2])).toBe("bash")
    })

    it("should return undefined for missing or invalid configs", () => {
      expect(readShellConfig([path.join(tmp, "missing.json")])).toBeUndefined()
      const p = path.join(tmp, "bad.json")
      fs.writeFileSync(p, "{ not json }}}")
      expect(readShellConfig([p])).toBeUndefined()
    })
  })

  describe("snipBin", () => {
    it("should prefer a local snip.exe over PATH", () => {
      const origPath = process.env.PATH
      process.env.PATH = ""
      fsMock.forceLocalSnip = true
      try {
        expect(snipBin()).toBe(path.join(DIR, "snip.exe"))
      } finally {
        process.env.PATH = origPath
        fsMock.forceLocalSnip = false
      }
    })

    it("should fall back to PATH when no local binary exists", () => {
      fsMock.noLocalSnip = true
      try {
        expect(snipBin()).toBe("snip")
      } finally {
        fsMock.noLocalSnip = false
      }
    })
  })
})
