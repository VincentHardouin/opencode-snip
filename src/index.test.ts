import { describe, it, expect, beforeEach } from "vitest"
import { toolExecuteBefore } from "./index"

describe("toolExecuteBefore", () => {
  let mockInput: { tool: string; sessionID: string; callID: string }
  let mockOutput: { args: { command: string } }

  beforeEach(() => {
    mockInput = { tool: "bash", sessionID: "s", callID: "c" }
    mockOutput = { args: { command: "" } }
  })

  it("should prefix simple command with snip", async () => {
    mockOutput.args.command = "go test ./..."
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip go test ./...")
  })

  it("should handle command with one env var prefix", async () => {
    mockOutput.args.command = "CGO_ENABLED=0 go test ./..."
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("CGO_ENABLED=0 snip go test ./...")
  })

  it("should handle command with multiple env var prefixes", async () => {
    mockOutput.args.command = "CGO_ENABLED=0 GOOS=linux go test ./..."
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("CGO_ENABLED=0 GOOS=linux snip go test ./...")
  })

  it("should handle command with &&", async () => {
    mockOutput.args.command = "go test && go build"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip go test && go build")
  })

  it("should handle command with |", async () => {
    mockOutput.args.command = "git log | head"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip git log | head")
  })

  it("should handle command with ;", async () => {
    mockOutput.args.command = "go test; go build"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip go test; go build")
  })

  it("should not double prefix already prefixed command", async () => {
    mockOutput.args.command = "snip go test"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("snip go test")
  })

  it("should not modify non-bash tool calls", async () => {
    mockInput.tool = "read"
    mockOutput.args.command = "go test"
    await toolExecuteBefore(mockInput, mockOutput)
    expect(mockOutput.args.command).toBe("go test")
  })

  describe("unproxyable shell builtins", () => {
    it("should skip cd", async () => {
      mockOutput.args.command = "cd /tmp"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("cd /tmp")
    })

    it("should skip source", async () => {
      mockOutput.args.command = "source ~/.bashrc"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("source ~/.bashrc")
    })

    it("should skip . (dot)", async () => {
      mockOutput.args.command = ". ./env.sh"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe(". ./env.sh")
    })

    it("should skip export", async () => {
      mockOutput.args.command = "export FOO=bar"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("export FOO=bar")
    })

    it("should skip alias", async () => {
      mockOutput.args.command = 'alias ll="ls -la"'
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe('alias ll="ls -la"')
    })

    it("should skip unset", async () => {
      mockOutput.args.command = "unset VAR"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("unset VAR")
    })

    it("should skip export with env var prefix", async () => {
      mockOutput.args.command = "CGO_ENABLED=0 export FOO=bar"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("CGO_ENABLED=0 export FOO=bar")
    })

    it("should skip cd when followed by &&", async () => {
      mockOutput.args.command = "cd /tmp && ls"
      await toolExecuteBefore(mockInput, mockOutput)
      expect(mockOutput.args.command).toBe("cd /tmp && ls")
    })
  })
})
