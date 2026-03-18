import { afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { TerminalManager } from "./terminal-manager"

const SHELL_START_TIMEOUT_MS = 5_000
const COMMAND_TIMEOUT_MS = 5_000

const isSupportedPlatform = process.platform !== "win32" && typeof Bun.Terminal === "function"
const describeIfSupported = isSupportedPlatform ? describe : describe.skip

let tempProjectPath = ""

beforeAll(async () => {
  if (!isSupportedPlatform) return
  tempProjectPath = await mkdtemp(path.join(os.tmpdir(), "kanna-terminal-manager-"))
})

afterEach(async () => {
  if (!tempProjectPath) return
  await rm(tempProjectPath, { recursive: true, force: true })
  tempProjectPath = await mkdtemp(path.join(os.tmpdir(), "kanna-terminal-manager-"))
})

async function waitFor(check: () => boolean, timeoutMs: number, intervalMs = 25) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return
    await Bun.sleep(intervalMs)
  }
  throw new Error(`Timed out after ${timeoutMs}ms`)
}

async function createSession(terminalId: string) {
  const manager = new TerminalManager()
  let output = ""
  manager.onEvent((event) => {
    if (event.type === "terminal.output" && event.terminalId === terminalId) {
      output += event.data
    }
  })

  manager.createTerminal({
    projectPath: tempProjectPath,
    terminalId,
    cols: 80,
    rows: 24,
    scrollback: 1_000,
  })

  manager.write(terminalId, "printf '__KANNA_READY__\\n'\r")
  await waitFor(() => output.includes("__KANNA_READY__"), SHELL_START_TIMEOUT_MS)

  return {
    manager,
    getOutput: () => output,
  }
}

describeIfSupported("TerminalManager", () => {
  test("ctrl+c interrupts the foreground job and keeps the shell alive", async () => {
    const terminalId = "terminal-ctrl-c-foreground"
    const { manager, getOutput } = await createSession(terminalId)

    try {
      manager.write(terminalId, 'python3 -c "import time; time.sleep(30)"\r')
      await waitFor(() => getOutput().includes("time.sleep(30)"), COMMAND_TIMEOUT_MS)

      manager.write(terminalId, "\x03")
      manager.write(terminalId, "printf '__KANNA_AFTER_INT__\\n'\r")

      await waitFor(() => getOutput().includes("__KANNA_AFTER_INT__"), COMMAND_TIMEOUT_MS)

      const snapshot = manager.getSnapshot(terminalId)
      expect(snapshot?.status).toBe("running")
      expect(getOutput()).toContain("__KANNA_AFTER_INT__")
    } finally {
      manager.close(terminalId)
    }
  })

  test("ctrl+c at an idle prompt does not exit the shell", async () => {
    const terminalId = "terminal-ctrl-c-prompt"
    const { manager, getOutput } = await createSession(terminalId)

    try {
      const before = getOutput()
      manager.write(terminalId, "\x03")

      await waitFor(() => getOutput().length > before.length, COMMAND_TIMEOUT_MS)

      const snapshot = manager.getSnapshot(terminalId)
      expect(snapshot?.status).toBe("running")
      expect(getOutput().length).toBeGreaterThan(before.length)
    } finally {
      manager.close(terminalId)
    }
  })

  test("ctrl+d preserves eof behavior", async () => {
    const terminalId = "terminal-ctrl-d"
    const { manager } = await createSession(terminalId)

    try {
      manager.write(terminalId, "\x04")

      await waitFor(() => manager.getSnapshot(terminalId)?.status === "exited", COMMAND_TIMEOUT_MS)

      expect(manager.getSnapshot(terminalId)?.exitCode).toBe(0)
    } finally {
      manager.close(terminalId)
    }
  })
})
