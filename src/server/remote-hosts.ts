import path from "node:path"
import type { MachineId, RemoteHostConfig } from "../shared/types"
import { LOCAL_MACHINE_ID, remoteHostIdFromMachineId, toRemoteMachineId } from "../shared/project-location"
import type { DiscoveredProject } from "./discovery"

export type ProjectRuntime =
  | { kind: "local" }
  | { kind: "ssh"; host: RemoteHostConfig }

interface SshResult {
  exitCode: number
  stdout: string
  stderr: string
}

const DEFAULT_SSH_TIMEOUT_MS = 10_000

export function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function remotePathExpression(remotePath: string) {
  const trimmed = remotePath.trim()
  if (trimmed === "~") return "$HOME"
  if (trimmed.startsWith("~/")) return `$HOME${shellQuote(trimmed.slice(1))}`
  return shellQuote(trimmed)
}

function assertRemotePath(localPath: string) {
  const trimmed = localPath.trim()
  if (!trimmed) {
    throw new Error("Project path is required")
  }
  return trimmed
}

export function getRemoteMachineSummaries(remoteHosts: RemoteHostConfig[]) {
  return remoteHosts.map((host) => ({
    id: toRemoteMachineId(host.id),
    displayName: host.label,
    platform: "remote" as const,
    sshTarget: host.sshTarget,
    enabled: host.enabled,
  }))
}

export function resolveProjectRuntime(machineId: MachineId, remoteHosts: RemoteHostConfig[]): ProjectRuntime {
  if (machineId === LOCAL_MACHINE_ID) return { kind: "local" }
  const hostId = remoteHostIdFromMachineId(machineId)
  const host = hostId ? remoteHosts.find((entry) => entry.id === hostId) : null
  if (!host) {
    throw new Error(`Remote host is not configured: ${machineId}`)
  }
  if (!host.enabled) {
    throw new Error(`Remote host is disabled: ${host.label}`)
  }
  return { kind: "ssh", host }
}

export async function runSsh(host: RemoteHostConfig, remoteCommand: string, timeoutMs = DEFAULT_SSH_TIMEOUT_MS): Promise<SshResult> {
  const child = Bun.spawn([
    "ssh",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    host.sshTarget,
    remoteCommand,
  ], {
    stdout: "pipe",
    stderr: "pipe",
  })

  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill("SIGKILL")
  }, timeoutMs)

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])

    if (timedOut) {
      return {
        exitCode: 124,
        stdout,
        stderr: stderr || "SSH command timed out",
      }
    }

    return { exitCode, stdout, stderr }
  } finally {
    clearTimeout(timeout)
  }
}

export async function ensureRemoteProjectDirectory(host: RemoteHostConfig, localPath: string) {
  const targetPath = assertRemotePath(localPath)
  const command = `mkdir -p ${remotePathExpression(targetPath)} && cd ${remotePathExpression(targetPath)} && pwd -P`
  const result = await runSsh(host, command)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Failed to prepare remote project path on ${host.label}`)
  }
  return result.stdout.trim().split("\n").at(-1) || targetPath
}

export async function verifyRemoteProjectDirectory(host: RemoteHostConfig, localPath: string) {
  const targetPath = assertRemotePath(localPath)
  const command = `cd ${remotePathExpression(targetPath)} && pwd -P`
  const result = await runSsh(host, command)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `Remote project path does not exist on ${host.label}`)
  }
  return result.stdout.trim().split("\n").at(-1) || targetPath
}

export function getRemoteCodexAppServerCommand(cwd: string) {
  return `cd ${remotePathExpression(cwd)} && exec codex app-server`
}

export function getRemoteShellCommand(cwd: string) {
  return `cd ${remotePathExpression(cwd)} && exec "\${SHELL:-/bin/sh}" -l`
}

export async function discoverRemoteProjects(remoteHosts: RemoteHostConfig[]): Promise<DiscoveredProject[]> {
  const projects: DiscoveredProject[] = []
  await Promise.all(remoteHosts.filter((host) => host.enabled).map(async (host) => {
    if (host.projectRoots.length === 0) return

    const rootExpressions = host.projectRoots.map(remotePathExpression).join(" ")
    const command = [
      `for root in ${rootExpressions}; do`,
      "  [ -d \"$root\" ] || continue",
      "  for candidate in \"$root\" \"$root\"/* \"$root\"/*/*; do",
      "    [ -d \"$candidate/.git\" ] || continue",
      "    (cd \"$candidate\" && pwd -P)",
      "  done",
      "done | awk '!seen[$0]++'",
    ].join("\n")
    const result = await runSsh(host, command, 15_000)
    if (result.exitCode !== 0) {
      console.warn(`[kanna] remote discovery failed for ${host.label}: ${result.stderr.trim() || `exit ${result.exitCode}`}`)
      return
    }

    for (const line of result.stdout.split("\n")) {
      const localPath = line.trim()
      if (!localPath) continue
      projects.push({
        machineId: toRemoteMachineId(host.id),
        localPath,
        title: path.posix.basename(localPath) || localPath,
        modifiedAt: Date.now(),
      })
    }
  }))
  return projects
}
