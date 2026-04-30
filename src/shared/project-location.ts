import type { MachineAliases, MachineId, RemoteHostConfig } from "./types"

export const LOCAL_MACHINE_ID: MachineId = "local"

export function toRemoteMachineId(hostId: string): MachineId {
  return `remote:${hostId}`
}

export function normalizeMachineId(value: unknown): MachineId {
  if (value === LOCAL_MACHINE_ID) return LOCAL_MACHINE_ID
  if (typeof value === "string" && value.startsWith("remote:") && value.length > "remote:".length) {
    return value as MachineId
  }
  return LOCAL_MACHINE_ID
}

export function getProjectLocationKey(machineId: MachineId, localPath: string) {
  return `${machineId}\u0000${localPath}`
}

export function remoteHostIdFromMachineId(machineId: MachineId) {
  return machineId.startsWith("remote:") ? machineId.slice("remote:".length) : null
}

export function getMachineLabel(
  machineId: MachineId,
  remoteHosts: RemoteHostConfig[],
  localDisplayName = "Local",
  aliases: MachineAliases = {}
) {
  const alias = aliases[machineId]?.trim()
  if (alias) return alias
  if (machineId === LOCAL_MACHINE_ID) return localDisplayName
  const hostId = remoteHostIdFromMachineId(machineId)
  return remoteHosts.find((host) => host.id === hostId)?.label ?? hostId ?? machineId
}
