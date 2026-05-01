import type { MachineId, MachineSummary } from "../../shared/types"
import { LOCAL_MACHINE_ID, remoteHostIdFromMachineId } from "../../shared/project-location"

export function getVscodeRemoteSshUri(
  machine: Pick<MachineSummary, "id" | "sshTarget"> | null | undefined,
  remotePath: string,
  options: { fallbackSshTarget?: string | null } = {}
) {
  const sshTarget = getVscodeRemoteSshTarget(machine, options.fallbackSshTarget)
  if (!sshTarget) return null

  const encodedTarget = encodeRemoteAuthority(sshTarget)
  const encodedPath = encodeRemotePath(remotePath)
  if (!encodedPath) return null

  return `vscode://vscode-remote/ssh-remote+${encodedTarget}${encodedPath}`
}

export function getBrowserSshTargetForPath(
  remotePath: string,
  locationLike: Pick<Location, "hostname"> | null = typeof window === "undefined" ? null : window.location
) {
  const hostname = locationLike?.hostname?.trim().replace(/^\[(.*)]$/, "$1")
  if (!hostname || isLoopbackHost(hostname)) return null

  const username = inferSshUsernameFromPath(remotePath)
  return username ? `${username}@${hostname}` : hostname
}

function getVscodeRemoteSshTarget(
  machine: Pick<MachineSummary, "id" | "sshTarget"> | null | undefined,
  fallbackSshTarget?: string | null
) {
  if (!machine) return fallbackSshTarget?.trim() || null

  const sshTarget = machine.sshTarget?.trim()
  if (sshTarget) return sshTarget

  if (machine.id === LOCAL_MACHINE_ID) return fallbackSshTarget?.trim() || null

  return remoteHostIdFromMachineId(machine.id as MachineId)
}

function inferSshUsernameFromPath(value: string) {
  const normalized = value.trim().replaceAll("\\", "/")
  if (normalized === "/root" || normalized.startsWith("/root/")) return "root"

  return normalized.match(/^\/home\/([^/]+)/)?.[1]
    ?? normalized.match(/^\/Users\/([^/]+)/)?.[1]
    ?? normalized.match(/^\/[a-zA-Z]\/Users\/([^/]+)/)?.[1]
    ?? null
}

function isLoopbackHost(hostname: string) {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "0:0:0:0:0:0:0:1"
}

function encodeRemoteAuthority(value: string) {
  return encodeURIComponent(value.trim())
    .replace(/%40/gi, "@")
    .replace(/%3A/gi, ":")
}

function encodeRemotePath(value: string) {
  const normalized = value.trim().replaceAll("\\", "/")
  if (!normalized) return null

  const path = normalized.startsWith("/") ? normalized : `/${normalized}`
  return path
    .split("/")
    .map((segment, index) => index === 0 ? "" : encodeURIComponent(segment))
    .join("/")
}
