import path from "node:path"
import type { MachineAliases, MachineId, RemoteHostConfig } from "../shared/types"
import { LOCAL_MACHINE_ID, remoteHostIdFromMachineId, toRemoteMachineId } from "../shared/project-location"
import type { DiscoveredProject } from "./discovery"

export type ProjectRuntime =
  | { kind: "local" }
  | { kind: "ssh"; host: RemoteHostConfig }

export interface SshResult {
  exitCode: number
  stdout: string
  stderr: string
}

interface RemoteDiscoveryRow {
  localPath?: unknown
  title?: unknown
  modifiedAt?: unknown
}

const DEFAULT_SSH_TIMEOUT_MS = 10_000

export function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function remotePathExpression(remotePath: string) {
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

export function getRemoteMachineSummaries(remoteHosts: RemoteHostConfig[], aliases: MachineAliases = {}) {
  return remoteHosts.map((host) => {
    const machineId = toRemoteMachineId(host.id)
    return {
      id: machineId,
      displayName: aliases[machineId]?.trim() || host.label,
      platform: "remote" as const,
      sshTarget: host.sshTarget,
      enabled: host.enabled,
    }
  })
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

export async function runSshWithInput(host: RemoteHostConfig, remoteCommand: string, input: string | null, timeoutMs = DEFAULT_SSH_TIMEOUT_MS): Promise<SshResult> {
  const child = Bun.spawn([
    "ssh",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    host.sshTarget,
    remoteCommand,
  ], {
    stdin: input === null ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })

  if (input !== null) {
    child.stdin!.write(input)
    child.stdin!.end()
  }

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

export async function runSsh(host: RemoteHostConfig, remoteCommand: string, timeoutMs = DEFAULT_SSH_TIMEOUT_MS): Promise<SshResult> {
  return runSshWithInput(host, remoteCommand, null, timeoutMs)
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

function getLegacyRemoteProjectRootDiscoveryCommand(projectRoots: string[]) {
  if (projectRoots.length === 0) {
    return "true"
  }

  const rootExpressions = projectRoots.map(remotePathExpression).join(" ")
  return [
    `for root in ${rootExpressions}; do`,
    "  [ -d \"$root\" ] || continue",
    "  for candidate in \"$root\" \"$root\"/* \"$root\"/*/*; do",
    "    [ -d \"$candidate/.git\" ] || [ -d \"$candidate/.codex\" ] || [ -d \"$candidate/.claude\" ] || [ -f \"$candidate/CLAUDE.md\" ] || [ -f \"$candidate/AGENTS.md\" ] || continue",
    "    (cd \"$candidate\" && pwd -P)",
    "  done",
    "done | awk '!seen[$0]++'",
  ].join("\n")
}

export function getRemoteNodeDiscoveryScript(projectRoots: string[]) {
  return [
    `const projectRoots = ${JSON.stringify(projectRoots)};`,
    String.raw`const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const home = process.env.HOME || os.homedir();
const isWin = process.platform === "win32";
const projects = new Map();

function toNativePath(value) {
  let input = String(value || "").trim();
  if (!input) return input;
  if (input === "~") {
    input = home;
  } else if (input.startsWith("~/") || input.startsWith("~\\")) {
    input = path.join(home, input.slice(2));
  }
  if (isWin) {
    const driveMatch = input.match(/^\/([a-zA-Z])(?:\/(.*))?$/);
    if (driveMatch) {
      return driveMatch[1].toUpperCase() + ":\\" + (driveMatch[2] || "").replace(/\//g, "\\");
    }
  }
  return input;
}

function toRemotePath(nativePath) {
  let resolved = String(nativePath);
  try {
    resolved = fs.realpathSync(nativePath);
  } catch {
    resolved = path.resolve(nativePath);
  }
  if (isWin) {
    const match = resolved.match(/^([a-zA-Z]):[\\/]?(.*)$/);
    if (match) {
      const rest = match[2].replace(/[\\/]+/g, "/");
      return "/" + match[1].toLowerCase() + (rest ? "/" + rest : "");
    }
  }
  return resolved.replace(/\\/g, "/");
}

function comparePath(remotePath) {
  return isWin ? remotePath.toLowerCase() : remotePath;
}

function isIgnoredProjectPath(remotePath) {
  const normalized = comparePath(remotePath).replace(/\/+$/, "");
  const homePath = comparePath(toRemotePath(home)).replace(/\/+$/, "");
  if (normalized === homePath) return true;
  if (normalized === homePath + "/.claude" || normalized.startsWith(homePath + "/.claude/")) return true;
  if (normalized === homePath + "/.codex" || normalized.startsWith(homePath + "/.codex/")) return true;
  if (normalized === homePath + "/.kanna" || normalized.startsWith(homePath + "/.kanna/")) return true;
  if (normalized === homePath + "/.kanna-dev" || normalized.startsWith(homePath + "/.kanna-dev/")) return true;
  if (normalized.includes("/.claude/worktrees/")) return true;
  if (isWin && /^\/[a-z]\/windows(?:\/|$)/.test(normalized)) return true;
  if (isWin && /^\/[a-z]\/program files(?: \(x86\))?(?:\/|$)/.test(normalized)) return true;
  return false;
}

function isDirectory(nativePath) {
  try {
    return fs.statSync(nativePath).isDirectory();
  } catch {
    return false;
  }
}

function readJson(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function fileMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return Date.now();
  }
}

function addProject(inputPath, modifiedAt, title) {
  if (typeof inputPath !== "string" || !inputPath.trim()) return;
  const nativePath = toNativePath(inputPath);
  if (!isDirectory(nativePath)) return;
  const localPath = toRemotePath(nativePath);
  if (isIgnoredProjectPath(localPath)) return;
  const timestamp = Number.isFinite(modifiedAt) ? modifiedAt : fileMtime(nativePath);
  const name = typeof title === "string" && title.trim()
    ? title.trim()
    : localPath.split("/").filter(Boolean).at(-1) || path.basename(nativePath) || localPath;
  const key = comparePath(localPath);
  const existing = projects.get(key);
  if (!existing || timestamp > existing.modifiedAt) {
    projects.set(key, { localPath, title: name, modifiedAt: timestamp });
  }
}

function readClaudeJsonProjects() {
  const claudeJsonPath = path.join(home, ".claude.json");
  const json = readJson(claudeJsonPath);
  const sourceProjects = json?.projects;
  if (!sourceProjects || typeof sourceProjects !== "object" || Array.isArray(sourceProjects)) return;
  const modifiedAt = fileMtime(claudeJsonPath);
  for (const projectPath of Object.keys(sourceProjects)) {
    addProject(projectPath, modifiedAt);
  }
}

function joinCandidate(currentPath, segment) {
  if (isWin && /^[A-Za-z]:\\?$/.test(currentPath)) {
    return path.join(currentPath, segment);
  }
  return currentPath + "/" + segment;
}

function resolveEncodedClaudePath(folderName) {
  const segments = folderName.replace(/^-/, "").split("-").filter(Boolean);
  let currentPath = "";
  if (isWin && segments.length > 0 && /^[A-Za-z]$/.test(segments[0])) {
    currentPath = segments.shift().toUpperCase() + ":\\";
  }
  let remainingSegments = [...segments];

  while (remainingSegments.length > 0) {
    let found = false;
    for (let index = remainingSegments.length; index >= 1; index -= 1) {
      const segment = remainingSegments.slice(0, index).join("-");
      const candidate = joinCandidate(currentPath, segment);
      if (isDirectory(toNativePath(candidate))) {
        currentPath = candidate;
        remainingSegments = remainingSegments.slice(index);
        found = true;
        break;
      }
    }
    if (!found) {
      const [head, ...tail] = remainingSegments;
      currentPath = joinCandidate(currentPath, head);
      remainingSegments = tail;
    }
  }

  return currentPath || "/";
}

function readClaudeProjectMarkers() {
  const projectsDir = path.join(home, ".claude", "projects");
  let entries = [];
  try {
    entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    addProject(resolveEncodedClaudePath(entry.name), fileMtime(path.join(projectsDir, entry.name)));
  }
}

function parseCodexProjectKey(line) {
  const match = line.match(/^\[projects\.(?:"((?:\\.|[^"])*)"|'([^']*)')\]$/);
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return null;
  return raw.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function readCodexConfiguredProjects() {
  const configPath = path.join(home, ".codex", "config.toml");
  let lines = [];
  try {
    lines = fs.readFileSync(configPath, "utf8").split(/\r?\n/);
  } catch {
    return;
  }
  const modifiedAt = fileMtime(configPath);
  for (const line of lines) {
    const projectPath = parseCodexProjectKey(line.trim());
    if (projectPath) addProject(projectPath, modifiedAt);
  }
}

function collectJsonlFiles(directory) {
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJsonlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(fullPath);
    }
  }
  return files;
}

function parseJsonRecord(line) {
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readCodexSessionIndex() {
  const updatedAtById = new Map();
  const indexPath = path.join(home, ".codex", "session_index.jsonl");
  let lines = [];
  try {
    lines = fs.readFileSync(indexPath, "utf8").split(/\r?\n/);
  } catch {
    return updatedAtById;
  }
  for (const line of lines) {
    if (!line.trim()) continue;
    const record = parseJsonRecord(line);
    const id = typeof record?.id === "string" ? record.id : null;
    const updatedAt = typeof record?.updated_at === "string" ? Date.parse(record.updated_at) : Number.NaN;
    if (!id || Number.isNaN(updatedAt)) continue;
    const existing = updatedAtById.get(id);
    if (existing === undefined || updatedAt > existing) updatedAtById.set(id, updatedAt);
  }
  return updatedAtById;
}

function isAbsoluteProjectPath(projectPath) {
  if (path.isAbsolute(toNativePath(projectPath))) return true;
  return isWin && /^\/[a-zA-Z](?:\/|$)/.test(projectPath);
}

function readCodexSessionProjects() {
  const sessionsDir = path.join(home, ".codex", "sessions");
  const updatedAtById = readCodexSessionIndex();
  for (const sessionFile of collectJsonlFiles(sessionsDir)) {
    const firstLine = fs.readFileSync(sessionFile, "utf8").split(/\r?\n/, 1)[0];
    if (!firstLine?.trim()) continue;
    const record = parseJsonRecord(firstLine);
    if (record?.type !== "session_meta") continue;
    const payload = record.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
    const sessionId = typeof payload.id === "string" ? payload.id : null;
    const cwd = typeof payload.cwd === "string" ? payload.cwd : null;
    if (!sessionId || !cwd || !isAbsoluteProjectPath(cwd)) continue;
    const recordTimestamp = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN;
    const payloadTimestamp = typeof payload.timestamp === "string" ? Date.parse(payload.timestamp) : Number.NaN;
    const modifiedAt = updatedAtById.get(sessionId)
      ?? [recordTimestamp, payloadTimestamp, fileMtime(sessionFile)].find((value) => !Number.isNaN(value))
      ?? fileMtime(sessionFile);
    addProject(cwd, modifiedAt);
  }
}

function hasProjectMarker(directory) {
  return isDirectory(path.join(directory, ".git"))
    || isDirectory(path.join(directory, ".codex"))
    || isDirectory(path.join(directory, ".claude"))
    || fs.existsSync(path.join(directory, "CLAUDE.md"))
    || fs.existsSync(path.join(directory, "AGENTS.md"));
}

function scanProjectRoot(root) {
  const nativeRoot = toNativePath(root);
  if (!isDirectory(nativeRoot)) return;
  const candidates = [nativeRoot];
  let children = [];
  try {
    children = fs.readdirSync(nativeRoot, { withFileTypes: true });
  } catch {
    children = [];
  }
  for (const child of children) {
    if (!child.isDirectory()) continue;
    const childPath = path.join(nativeRoot, child.name);
    candidates.push(childPath);
    let grandchildren = [];
    try {
      grandchildren = fs.readdirSync(childPath, { withFileTypes: true });
    } catch {
      grandchildren = [];
    }
    for (const grandchild of grandchildren) {
      if (grandchild.isDirectory()) candidates.push(path.join(childPath, grandchild.name));
    }
  }
  for (const candidate of candidates) {
    if (hasProjectMarker(candidate)) addProject(candidate);
  }
}

readClaudeJsonProjects();
readClaudeProjectMarkers();
readCodexConfiguredProjects();
readCodexSessionProjects();
for (const root of projectRoots) scanProjectRoot(root);

console.log(JSON.stringify([...projects.values()].sort((a, b) => b.modifiedAt - a.modifiedAt)));`,
  ].join("\n")
}

export function parseRemoteDiscoveryOutput(stdout: string): Array<Omit<DiscoveredProject, "machineId">> {
  const trimmed = stdout.trim()
  if (!trimmed) return []

  if (trimmed.startsWith("[")) {
    const rows = JSON.parse(trimmed) as RemoteDiscoveryRow[]
    if (!Array.isArray(rows)) return []

    return rows
      .map((row) => {
        const localPath = typeof row.localPath === "string" ? row.localPath.trim() : ""
        if (!localPath) return null
        const modifiedAt = typeof row.modifiedAt === "number" && Number.isFinite(row.modifiedAt)
          ? row.modifiedAt
          : Date.now()
        const title = typeof row.title === "string" && row.title.trim()
          ? row.title.trim()
          : path.posix.basename(localPath) || localPath
        return { localPath, title, modifiedAt }
      })
      .filter((project): project is Omit<DiscoveredProject, "machineId"> => Boolean(project))
  }

  return trimmed.split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((localPath) => ({
      localPath,
      title: path.posix.basename(localPath) || localPath,
      modifiedAt: Date.now(),
    }))
}

export async function discoverRemoteProjects(remoteHosts: RemoteHostConfig[]): Promise<DiscoveredProject[]> {
  const projects: DiscoveredProject[] = []
  await Promise.all(remoteHosts.filter((host) => host.enabled).map(async (host) => {
    const nodeCheck = await runSsh(host, "command -v node >/dev/null 2>&1", 5_000)
    if (nodeCheck.exitCode !== 0 && nodeCheck.stderr.trim()) {
      console.warn(`[kanna] remote discovery failed for ${host.label}: ${nodeCheck.stderr.trim()}`)
      return
    }

    const result = nodeCheck.exitCode === 0
      ? await runSshWithInput(host, "node -", getRemoteNodeDiscoveryScript(host.projectRoots), 20_000)
      : await runSsh(host, getLegacyRemoteProjectRootDiscoveryCommand(host.projectRoots), 15_000)
    if (result.exitCode !== 0) {
      console.warn(`[kanna] remote discovery failed for ${host.label}: ${result.stderr.trim() || `exit ${result.exitCode}`}`)
      return
    }

    let remoteProjects: Array<Omit<DiscoveredProject, "machineId">>
    try {
      remoteProjects = parseRemoteDiscoveryOutput(result.stdout)
    } catch (error) {
      console.warn(`[kanna] remote discovery failed for ${host.label}: ${error instanceof Error ? error.message : String(error)}`)
      return
    }

    for (const project of remoteProjects) {
      projects.push({
        machineId: toRemoteMachineId(host.id),
        ...project,
      })
    }
  }))
  return projects
}
