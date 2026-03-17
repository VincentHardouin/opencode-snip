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
})
