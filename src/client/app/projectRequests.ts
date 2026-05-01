import type { ClientCommand } from "../../shared/protocol"
import type { MachineId } from "../../shared/types"

export interface ProjectRequest {
  mode: "new" | "existing"
  machineId?: MachineId
  localPath: string
  title: string
}

export function getProjectRequestCommand(project: ProjectRequest): Extract<ClientCommand, { type: "project.create" }> {
  return {
    type: "project.create",
    localPath: project.localPath,
    title: project.title,
    machineId: project.machineId,
  }
}
