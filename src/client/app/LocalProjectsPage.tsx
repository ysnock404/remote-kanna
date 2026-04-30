import { useOutletContext } from "react-router-dom"
import type { MachineId } from "../../shared/types"
import { LocalDev } from "../components/LocalDev"
import type { KannaState } from "./useKannaState"

export function LocalProjectsPage() {
  const state = useOutletContext<KannaState>()

  return (
    <div className="flex-1 flex flex-col min-w-0 relative">
      <LocalDev
        connectionStatus={state.connectionStatus}
        ready={state.localProjectsReady}
        snapshot={state.localProjects}
        startingLocalPath={state.startingLocalPath}
        commandError={state.commandError}
        newProjectOpen={state.addProjectModalOpen}
        selectedMachineId={state.selectedMachineId}
        onNewProjectOpenChange={(open) => {
          if (open) {
            state.openAddProjectModal()
            return
          }
          state.closeAddProjectModal()
        }}
        onSelectMachine={state.setSelectedMachineId}
        onRenameMachine={async (machineId: MachineId, label: string) => {
          await state.handleWriteAppSettings({
            machineAliases: {
              ...(state.appSettings?.machineAliases ?? {}),
              [machineId]: label,
            },
          })
        }}
        onOpenGeneralChat={state.handleCreateGeneralChat}
        onOpenProject={state.handleOpenLocalProject}
        onCreateProject={state.handleCreateProject}
        onBrowseDirectories={state.handleListDirectories}
      />
    </div>
  )
}
