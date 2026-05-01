import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { importStandaloneCodexSessions, scanStandaloneCodexSessions } from "./codex-session-import"
import { EventStore } from "./event-store"

const tempDirs: string[] = []

function makeTempDir(prefix: string) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function writeSession(homeDir: string, name: string, records: unknown[]) {
  const sessionsDir = path.join(homeDir, ".codex", "sessions", "2026", "05", "01")
  mkdirSync(sessionsDir, { recursive: true })
  const filePath = path.join(sessionsDir, `${name}.jsonl`)
  writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`)
  return filePath
}

function sessionMeta(args: {
  id: string
  cwd: string
  timestamp?: string
  originator?: string
  source?: unknown
}) {
  return {
    timestamp: args.timestamp ?? "2026-05-01T00:00:00.000Z",
    type: "session_meta",
    payload: {
      id: args.id,
      timestamp: args.timestamp ?? "2026-05-01T00:00:00.000Z",
      cwd: args.cwd,
      originator: args.originator ?? "codex-tui",
      source: args.source ?? "cli",
    },
  }
}

function responseMessage(timestamp: string, role: "user" | "assistant", text: string) {
  return {
    timestamp,
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: [{
        type: role === "user" ? "input_text" : "output_text",
        text,
      }],
    },
  }
}

describe("Codex standalone session import", () => {
  test("scans standalone home-dir Codex TUI sessions and ignores project, subagent, and Kanna sessions", () => {
    const homeDir = makeTempDir("kanna-codex-home-")
    const projectDir = path.join(homeDir, "project")
    mkdirSync(projectDir, { recursive: true })

    writeSession(homeDir, "home-session", [
      sessionMeta({ id: "session-home", cwd: homeDir, timestamp: "2026-05-01T00:00:00.000Z" }),
      responseMessage("2026-05-01T00:00:01.000Z", "user", "<environment_context>\n  <cwd>ignored</cwd>\n</environment_context>"),
      responseMessage("2026-05-01T00:00:02.000Z", "user", "old standalone chat"),
      responseMessage("2026-05-01T00:00:03.000Z", "assistant", "old answer"),
    ])
    writeSession(homeDir, "project-session", [
      sessionMeta({ id: "session-project", cwd: projectDir }),
      responseMessage("2026-05-01T00:00:02.000Z", "user", "project chat"),
    ])
    writeSession(homeDir, "subagent-session", [
      sessionMeta({
        id: "session-subagent",
        cwd: homeDir,
        source: { subagent: { thread_spawn: { parent_thread_id: "parent" } } },
      }),
      responseMessage("2026-05-01T00:00:02.000Z", "user", "subagent chat"),
    ])
    writeSession(homeDir, "kanna-session", [
      sessionMeta({ id: "session-kanna", cwd: homeDir, originator: "kanna_desktop", source: "vscode" }),
      responseMessage("2026-05-01T00:00:02.000Z", "user", "kanna chat"),
    ])

    const sessions = scanStandaloneCodexSessions(homeDir)

    expect(sessions.map((session) => session.id)).toEqual(["session-home"])
    expect(sessions[0]?.title).toBe("old standalone chat")
    expect(sessions[0]?.entries.map((entry) => entry.kind)).toEqual(["user_prompt", "assistant_text"])
  })

  test("imports standalone Codex sessions into General Chat without duplicating them", async () => {
    const homeDir = makeTempDir("kanna-codex-home-")
    const dataDir = makeTempDir("kanna-codex-store-")
    writeSession(homeDir, "home-session", [
      sessionMeta({ id: "session-home", cwd: homeDir, timestamp: "2026-05-01T00:00:00.000Z" }),
      responseMessage("2026-05-01T00:00:02.000Z", "user", "resume this old session"),
      responseMessage("2026-05-01T00:00:03.000Z", "assistant", "ready"),
    ])

    const store = new EventStore(dataDir)
    await store.initialize()

    await expect(importStandaloneCodexSessions(store, homeDir)).resolves.toEqual({
      scanned: 1,
      imported: 1,
      skipped: 0,
    })

    const generalProject = store.listProjects().find((project) => project.isGeneralChat)
    expect(generalProject?.localPath).toBe(homeDir)
    const chats = store.listChatsByProject(generalProject!.id)
    expect(chats).toHaveLength(1)
    expect(chats[0]).toMatchObject({
      title: "resume this old session",
      provider: "codex",
      sessionToken: "session-home",
    })
    expect(store.getMessages(chats[0]!.id).map((entry) => entry.kind)).toEqual(["user_prompt", "assistant_text"])

    await expect(importStandaloneCodexSessions(store, homeDir)).resolves.toEqual({
      scanned: 1,
      imported: 0,
      skipped: 1,
    })
    expect(store.listChatsByProject(generalProject!.id)).toHaveLength(1)

    writeSession(homeDir, "home-session", [
      sessionMeta({ id: "session-home", cwd: homeDir, timestamp: "2026-05-01T00:00:00.000Z" }),
      responseMessage("2026-05-01T00:00:02.000Z", "user", "resume this old session"),
      responseMessage("2026-05-01T00:00:03.000Z", "assistant", "ready"),
      responseMessage("2026-05-01T00:00:04.000Z", "assistant", "updated from disk"),
    ])
    await expect(importStandaloneCodexSessions(store, homeDir)).resolves.toEqual({
      scanned: 1,
      imported: 0,
      skipped: 1,
    })
    expect(store.getMessages(chats[0]!.id).map((entry) => entry.kind)).toEqual([
      "user_prompt",
      "assistant_text",
      "assistant_text",
    ])
  })
})
