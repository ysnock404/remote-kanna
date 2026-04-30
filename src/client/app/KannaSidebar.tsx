import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from "react"
import { Eye, Flower, FolderPlus, Loader2, PanelLeft, X, Menu, Plus, RefreshCw, RotateCcw, Settings, MessageCircle, Search, Plug, Sparkles, SquarePen } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { APP_NAME } from "../../shared/branding"
import { LOCAL_MACHINE_ID } from "../../shared/project-location"
import { Button } from "../components/ui/button"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "../components/ui/context-menu"
import { formatSidebarAgeLabel, getPathBasename } from "../lib/formatters"
import { getSidebarChatTimestamp } from "../lib/sidebarChats"
import { cn } from "../lib/utils"
import { ChatRow } from "../components/chat-ui/sidebar/ChatRow"
import { LocalProjectsSection } from "../components/chat-ui/sidebar/LocalProjectsSection"
import { MachineSelector } from "../components/MachineSelector"
import { getResolvedKeybindings } from "../lib/keybindings"
import type { CodexAssetsSnapshot, CodexPluginSummary, CodexSkillSummary, HiddenProjectSummary, KeybindingsSnapshot, LocalProjectsSnapshot, MachineId, MachineSummary, SidebarData, SidebarChatRow, SidebarProjectGroup, UpdateSnapshot } from "../../shared/types"
import type { SocketStatus } from "./socket"
import {
  getSidebarJumpTargetIndex,
  getSidebarNumberJumpHint,
  getVisibleSidebarChats,
  isSidebarModifierShortcut,
  shouldShowSidebarNumberJumpHints,
} from "./sidebarNumberJump"

const SIDEBAR_WIDTH_STORAGE_KEY = "kanna:sidebar-width"
export const DEFAULT_SIDEBAR_WIDTH = 275
export const MIN_SIDEBAR_WIDTH = 220
export const MAX_SIDEBAR_WIDTH = 520

export function clampSidebarWidth(width: number) {
  if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)))
}

function readStoredSidebarWidth() {
  if (typeof window === "undefined") return DEFAULT_SIDEBAR_WIDTH
  const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
  return stored ? clampSidebarWidth(Number(stored)) : DEFAULT_SIDEBAR_WIDTH
}

function persistSidebarWidth(width: number) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)))
}

interface KannaSidebarProps {
  data: SidebarData
  activeChatId: string | null
  connectionStatus: SocketStatus
  ready: boolean
  open: boolean
  collapsed: boolean
  showMobileOpenButton: boolean
  onOpen: () => void
  onClose: () => void
  onCollapse: () => void
  onExpand: () => void
  localProjects: LocalProjectsSnapshot | null
  selectedMachineId: MachineId
  onSelectMachine: (machineId: MachineId) => void
  onRenameMachine: (machineId: MachineId, label: string) => Promise<void>
  onCreateChat: (projectId: string) => void
  onCreateGeneralChat: () => void
  onForkChat: (chat: SidebarChatRow) => void
  currentProjectId: string | null
  keybindings: KeybindingsSnapshot | null
  onRenameChat: (chat: SidebarChatRow) => void
  onShareChat: (chatId: string) => void
  onArchiveChat: (chat: SidebarChatRow) => void
  onOpenArchivedChat: (chatId: string) => void
  onDeleteChat: (chat: SidebarChatRow) => void
  onRenameProject: (projectId: string, currentTitle: string) => void
  onOpenAddProjectModal: () => void
  onCopyPath: (localPath: string) => void
  onOpenExternalPath: (action: "open_finder" | "open_editor", localPath: string, machineId?: MachineId) => void
  onHideProject: (projectId: string) => void
  onListHiddenProjects: (machineId: MachineId) => Promise<HiddenProjectSummary[]>
  onRestoreHiddenProject: (project: HiddenProjectSummary) => Promise<void>
  onScanCodexAssets: (machineId: MachineId) => Promise<CodexAssetsSnapshot>
  onReorderProjectGroups: (projectIds: string[]) => void
  editorLabel: string
  updateSnapshot: UpdateSnapshot | null
  onOpenChangelog: () => void
}

function getSidebarMachines(localProjects: LocalProjectsSnapshot | null): MachineSummary[] {
  if (localProjects?.machines?.length) return localProjects.machines
  if (!localProjects) return []
  return [{
    id: LOCAL_MACHINE_ID,
    displayName: localProjects.machine.displayName,
    platform: localProjects.machine.platform,
    enabled: true,
  }]
}

function getMachineProjectCounts(projectGroups: SidebarProjectGroup[]) {
  const counts = new Map<MachineId, number>()
  for (const group of projectGroups) {
    if (group.isGeneralChat) continue
    const machineId = group.machineId ?? LOCAL_MACHINE_ID
    counts.set(machineId, (counts.get(machineId) ?? 0) + 1)
  }
  return counts
}

function SidebarPanelLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
      {children}
    </div>
  )
}

function ProjectsPanelMenu({
  canCreateChat,
  onCreateChat,
  onAddProject,
  onShowHiddenProjects,
  children,
}: {
  canCreateChat: boolean
  onCreateChat: () => void
  onAddProject: () => void
  onShowHiddenProjects: () => void
  children: ReactNode
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!canCreateChat}
          onSelect={(event) => {
            event.stopPropagation()
            if (!canCreateChat) return
            onCreateChat()
          }}
        >
          <SquarePen className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">New chat</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            onAddProject()
          }}
        >
          <FolderPlus className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Open project</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={(event) => {
            event.stopPropagation()
            onShowHiddenProjects()
          }}
        >
          <Eye className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Hidden projects</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function SidebarActionRow({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground transition-colors",
        "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled && "cursor-not-allowed opacity-45 hover:bg-transparent"
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

function AssetBadge({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
      {children}
    </span>
  )
}

function SkillAssetRow({ skill }: { skill: CodexSkillSummary }) {
  return (
    <div className="rounded-lg border border-border/0 px-3 py-2 transition-colors hover:border-border hover:bg-muted">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 truncate text-sm font-medium">{skill.name}</div>
        <AssetBadge>{skill.scope}</AssetBadge>
      </div>
      {skill.description ? (
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{skill.description}</div>
      ) : null}
      <div className="mt-1 truncate text-[11px] text-muted-foreground/70">{skill.path}</div>
    </div>
  )
}

function PluginAssetRow({ plugin }: { plugin: CodexPluginSummary }) {
  const title = plugin.displayName?.trim() || plugin.name
  return (
    <div className="rounded-lg border border-border/0 px-3 py-2 transition-colors hover:border-border hover:bg-muted">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 truncate text-sm font-medium">{title}</div>
        <div className="flex shrink-0 items-center gap-1">
          <AssetBadge>{plugin.source}</AssetBadge>
          {plugin.installation ? <AssetBadge>{plugin.installation}</AssetBadge> : null}
        </div>
      </div>
      {plugin.description ? (
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{plugin.description}</div>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground/70">
        {plugin.version ? <span>v{plugin.version}</span> : null}
        {plugin.category ? <span>{plugin.category}</span> : null}
        {plugin.skillCount !== undefined ? <span>{plugin.skillCount} skills</span> : null}
        {plugin.commandCount !== undefined ? <span>{plugin.commandCount} commands</span> : null}
      </div>
      <div className="mt-1 truncate text-[11px] text-muted-foreground/70">{plugin.path}</div>
    </div>
  )
}

function KannaSidebarImpl({
  data,
  activeChatId,
  connectionStatus,
  ready,
  open,
  collapsed,
  showMobileOpenButton,
  onOpen,
  onClose,
  onCollapse,
  onExpand,
  localProjects,
  selectedMachineId,
  onSelectMachine,
  onRenameMachine,
  onCreateChat,
  onCreateGeneralChat,
  onForkChat,
  currentProjectId,
  keybindings,
  onRenameChat,
  onShareChat,
  onArchiveChat,
  onOpenArchivedChat,
  onDeleteChat,
  onRenameProject,
  onOpenAddProjectModal,
  onCopyPath,
  onOpenExternalPath,
  onHideProject,
  onListHiddenProjects,
  onRestoreHiddenProject,
  onScanCodexAssets,
  onReorderProjectGroups,
  editorLabel,
  updateSnapshot,
  onOpenChangelog,
}: KannaSidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const resizeStartRef = useRef<{ pointerX: number; width: number } | null>(null)
  const initializedCollapsedGroupKeysRef = useRef<Set<string>>(new Set())
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [showNumberJumpHints, setShowNumberJumpHints] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(readStoredSidebarWidth)
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const [archivedProjectId, setArchivedProjectId] = useState<string | null>(null)
  const [hiddenProjectsDialogOpen, setHiddenProjectsDialogOpen] = useState(false)
  const [hiddenProjects, setHiddenProjects] = useState<HiddenProjectSummary[]>([])
  const [hiddenProjectsLoading, setHiddenProjectsLoading] = useState(false)
  const [hiddenProjectsError, setHiddenProjectsError] = useState<string | null>(null)
  const [restoringHiddenProjectId, setRestoringHiddenProjectId] = useState<string | null>(null)
  const [searchDialogOpen, setSearchDialogOpen] = useState(false)
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState("")
  const [assetDialog, setAssetDialog] = useState<"plugins" | "skills" | null>(null)
  const [codexAssets, setCodexAssets] = useState<CodexAssetsSnapshot | null>(null)
  const [codexAssetsLoading, setCodexAssetsLoading] = useState(false)
  const [codexAssetsError, setCodexAssetsError] = useState<string | null>(null)
  const resolvedKeybindings = useMemo(() => getResolvedKeybindings(keybindings), [keybindings])
  const visibleChats = useMemo(
    () => getVisibleSidebarChats(data.projectGroups, collapsedSections, expandedGroups),
    [collapsedSections, data.projectGroups, expandedGroups]
  )
  const visibleChatsRef = useRef(visibleChats)
  const visibleIndexByChatId = useMemo(
    () => new Map(visibleChats.map((entry) => [entry.chat.chatId, entry.visibleIndex])),
    [visibleChats]
  )
  const machines = useMemo(() => getSidebarMachines(localProjects), [localProjects])
  const activeMachine = machines.find((machine) => machine.id === selectedMachineId) ?? machines[0] ?? null
  const activeMachineId = activeMachine?.id ?? selectedMachineId
  const machineProjectCounts = useMemo(() => getMachineProjectCounts(data.projectGroups), [data.projectGroups])
  const generalProjectGroups = useMemo(
    () => data.projectGroups.filter((group) => group.isGeneralChat),
    [data.projectGroups]
  )
  const activeMachineProjectGroups = useMemo(
    () => data.projectGroups.filter((group) => (
      !group.isGeneralChat && (group.machineId ?? LOCAL_MACHINE_ID) === activeMachineId
    )),
    [activeMachineId, data.projectGroups]
  )
  const currentProjectGroup = useMemo(
    () => data.projectGroups.find((group) => group.groupKey === currentProjectId) ?? null,
    [currentProjectId, data.projectGroups]
  )
  const canCreateChatInCurrentProject = Boolean(
    currentProjectId
    && currentProjectGroup
    && !currentProjectGroup.isGeneralChat
    && (currentProjectGroup.machineId ?? LOCAL_MACHINE_ID) === activeMachineId
  )
  const sidebarSearchResults = useMemo(() => {
    const query = sidebarSearchQuery.trim().toLowerCase()
    if (!query) return []

    const results: Array<
      | { kind: "chat"; key: string; title: string; subtitle: string; chatId: string }
      | { kind: "project"; key: string; title: string; subtitle: string; projectId: string }
    > = []

    for (const group of [...generalProjectGroups, ...activeMachineProjectGroups]) {
      const projectTitle = group.title?.trim() || getPathBasename(group.localPath)
      const projectSubtitle = group.isGeneralChat ? "General Chat" : `${group.machineLabel ? `${group.machineLabel} - ` : ""}${group.localPath}`
      const projectMatches = !group.isGeneralChat && (
        projectTitle.toLowerCase().includes(query)
        || group.localPath.toLowerCase().includes(query)
        || group.machineLabel?.toLowerCase().includes(query)
      )

      if (projectMatches) {
        results.push({
          kind: "project",
          key: `project:${group.groupKey}`,
          title: projectTitle,
          subtitle: projectSubtitle,
          projectId: group.groupKey,
        })
      }

      for (const chat of group.chats) {
        if (!chat.title.toLowerCase().includes(query)) continue
        results.push({
          kind: "chat",
          key: `chat:${chat.chatId}`,
          title: chat.title,
          subtitle: group.isGeneralChat ? "General Chat" : `${projectTitle} - ${chat.machineLabel ?? group.machineLabel ?? "Device"}`,
          chatId: chat.chatId,
        })
      }
    }

    return results.slice(0, 30)
  }, [activeMachineProjectGroups, generalProjectGroups, sidebarSearchQuery])
  const activeCodexAssets = codexAssets?.machineId === activeMachineId ? codexAssets : null

  const activeVisibleCount = visibleChats.length
  const archivedProject = useMemo(
    () => data.projectGroups.find((group) => group.groupKey === archivedProjectId) ?? null,
    [archivedProjectId, data.projectGroups]
  )

  useEffect(() => {
    visibleChatsRef.current = visibleChats
  }, [visibleChats])

  useEffect(() => {
    setCollapsedSections((previous) => {
      const next = new Set<string>()
      const projectKeys = new Set(data.projectGroups.map((group) => group.groupKey))
      const initializedKeys = initializedCollapsedGroupKeysRef.current

      for (const key of previous) {
        if (projectKeys.has(key)) {
          next.add(key)
        }
      }

      initializedCollapsedGroupKeysRef.current = new Set(
        [...initializedKeys].filter((key) => projectKeys.has(key))
      )

      for (const group of data.projectGroups) {
        if (initializedCollapsedGroupKeysRef.current.has(group.groupKey)) continue
        initializedCollapsedGroupKeysRef.current.add(group.groupKey)
        if (group.defaultCollapsed) {
          next.add(group.groupKey)
        }
      }

      if (next.size === previous.size && [...next].every((key) => previous.has(key))) {
        return previous
      }

      return next
    })
  }, [data.projectGroups])

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((previous) => {
      const next = new Set(previous)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const toggleExpandedGroup = useCallback((key: string) => {
    setExpandedGroups((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const handleReorderActiveMachineProjectGroups = useCallback((newOrder: string[]) => {
    const reordered = [...newOrder]
    const activeSet = new Set(activeMachineProjectGroups.map((group) => group.groupKey))
    const mergedOrder = data.projectGroups.map((group) => (
      activeSet.has(group.groupKey) ? reordered.shift() ?? group.groupKey : group.groupKey
    ))
    onReorderProjectGroups(mergedOrder)
  }, [activeMachineProjectGroups, data.projectGroups, onReorderProjectGroups])

  const openAddProject = useCallback(() => {
    navigate("/")
    onClose()
    onOpenAddProjectModal()
  }, [navigate, onClose, onOpenAddProjectModal])

  const loadHiddenProjects = useCallback(async () => {
    setHiddenProjectsLoading(true)
    setHiddenProjectsError(null)
    try {
      setHiddenProjects(await onListHiddenProjects(activeMachineId))
    } catch (error) {
      setHiddenProjectsError(error instanceof Error ? error.message : String(error))
    } finally {
      setHiddenProjectsLoading(false)
    }
  }, [activeMachineId, onListHiddenProjects])

  const handleRestoreHiddenProject = useCallback(async (project: HiddenProjectSummary) => {
    setRestoringHiddenProjectId(project.id)
    setHiddenProjectsError(null)
    try {
      await onRestoreHiddenProject(project)
      setHiddenProjects((current) => current.filter((entry) => entry.id !== project.id))
    } catch (error) {
      setHiddenProjectsError(error instanceof Error ? error.message : String(error))
    } finally {
      setRestoringHiddenProjectId(null)
    }
  }, [onRestoreHiddenProject])

  const loadCodexAssets = useCallback(async () => {
    setCodexAssetsLoading(true)
    setCodexAssetsError(null)
    try {
      setCodexAssets(await onScanCodexAssets(activeMachineId))
    } catch (error) {
      setCodexAssetsError(error instanceof Error ? error.message : String(error))
    } finally {
      setCodexAssetsLoading(false)
    }
  }, [activeMachineId, onScanCodexAssets])

  useEffect(() => {
    if (!hiddenProjectsDialogOpen) return
    void loadHiddenProjects()
  }, [hiddenProjectsDialogOpen, loadHiddenProjects])

  useEffect(() => {
    if (!assetDialog) return
    void loadCodexAssets()
  }, [assetDialog, loadCodexAssets])

  const handleCreateChatInCurrentProject = useCallback(() => {
    if (!currentProjectId || !canCreateChatInCurrentProject) return
    onCreateChat(currentProjectId)
    onClose()
  }, [canCreateChatInCurrentProject, currentProjectId, onClose, onCreateChat])

  const renderChatRow = useCallback((chat: SidebarChatRow) => {
    const visibleIndex = visibleIndexByChatId.get(chat.chatId)

    return (
      <ChatRow
        key={chat._id}
        chat={chat}
        activeChatId={activeChatId}
        nowMs={nowMs}
        shortcutHint={visibleIndex ? getSidebarNumberJumpHint(resolvedKeybindings, visibleIndex) : null}
        showShortcutHint={showNumberJumpHints}
        onSelectChat={(chatId) => {
          navigate(`/chat/${chatId}`)
          onClose()
        }}
        onRenameChat={() => onRenameChat(chat)}
        onShareChat={() => onShareChat(chat.chatId)}
        onOpenInFinder={(localPath, machineId) => onOpenExternalPath("open_finder", localPath, machineId)}
        onForkChat={() => onForkChat(chat)}
        onArchiveChat={() => onArchiveChat(chat)}
        onDeleteChat={() => onDeleteChat(chat)}
      />
    )
  }, [activeChatId, navigate, nowMs, onArchiveChat, onClose, onDeleteChat, onForkChat, onOpenExternalPath, onRenameChat, onShareChat, resolvedKeybindings, showNumberJumpHints, visibleIndexByChatId])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now())
    }, 30_000)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      setShowNumberJumpHints(shouldShowSidebarNumberJumpHints(resolvedKeybindings, event))

      if (isSidebarModifierShortcut(resolvedKeybindings, "createChatInCurrentProject", event)) {
        if (!canCreateChatInCurrentProject) {
          return
        }

        event.preventDefault()
        handleCreateChatInCurrentProject()
        return
      }

      if (isSidebarModifierShortcut(resolvedKeybindings, "openAddProject", event)) {
        event.preventDefault()
        openAddProject()
        return
      }

      const targetIndex = getSidebarJumpTargetIndex(resolvedKeybindings, event)
      if (targetIndex === null) {
        return
      }

      const targetChat = visibleChatsRef.current[targetIndex - 1]?.chat
      if (!targetChat) {
        return
      }

      event.preventDefault()
      navigate(`/chat/${targetChat.chatId}`)
      onClose()
    }

    function handleKeyUp(event: KeyboardEvent) {
      setShowNumberJumpHints(shouldShowSidebarNumberJumpHints(resolvedKeybindings, event))
    }

    function clearHints() {
      setShowNumberJumpHints(false)
    }

    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", clearHints)

    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("blur", clearHints)
    }
  }, [canCreateChatInCurrentProject, handleCreateChatInCurrentProject, navigate, onClose, openAddProject, resolvedKeybindings])

  useEffect(() => {
    if (!activeChatId || !scrollContainerRef.current) return

    requestAnimationFrame(() => {
      const container = scrollContainerRef.current
      const activeElement = container?.querySelector(`[data-chat-id="${activeChatId}"]`) as HTMLElement | null
      if (!activeElement || !container) return

      const elementRect = activeElement.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()

      if (elementRect.top < containerRect.top + 38) {
        const relativeTop = elementRect.top - containerRect.top + container.scrollTop
        container.scrollTo({ top: relativeTop - 38, behavior: "smooth" })
      } else if (elementRect.bottom > containerRect.bottom) {
        const elementCenter = elementRect.top + elementRect.height / 2 - containerRect.top + container.scrollTop
        const containerCenter = container.clientHeight / 2
        container.scrollTo({ top: elementCenter - containerCenter, behavior: "smooth" })
      }
    })
  }, [activeChatId])

  useEffect(() => {
    if (!isResizingSidebar) return

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    function handlePointerMove(event: PointerEvent) {
      const resizeStart = resizeStartRef.current
      if (!resizeStart) return
      setSidebarWidth(clampSidebarWidth(resizeStart.width + event.clientX - resizeStart.pointerX))
    }

    function handlePointerUp() {
      setIsResizingSidebar(false)
      resizeStartRef.current = null
      setSidebarWidth((current) => {
        const next = clampSidebarWidth(current)
        persistSidebarWidth(next)
        return next
      })
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp, { once: true })

    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
  }, [isResizingSidebar])

  const hasVisibleChats = activeVisibleCount > 0
  const hasVisibleSidebarContent = generalProjectGroups.length > 0 || activeMachineProjectGroups.length > 0
  const isLocalProjectsActive = location.pathname === "/"
  const isSettingsActive = location.pathname.startsWith("/settings")
  const isUtilityPageActive = isLocalProjectsActive || isSettingsActive
  const isConnecting = connectionStatus === "connecting" || !ready
  const statusLabel = isConnecting ? "Connecting" : connectionStatus === "connected" ? "Connected" : "Disconnected"
  const statusDotClass = connectionStatus === "connected" ? "bg-emerald-500" : "bg-amber-500"
  const showUpdateButton = updateSnapshot?.updateAvailable === true
  const showDevBadge = updateSnapshot
    ? updateSnapshot.latestVersion === `${updateSnapshot.currentVersion}-dev`
    : false
  const isUpdating = updateSnapshot?.status === "updating" || updateSnapshot?.status === "restart_pending"

  return (
    <>
      {!open && showMobileOpenButton && (
        <Button
          variant="ghost"
          size="icon"
          className="fixed top-3 left-3 z-50 md:hidden"
          onClick={onOpen}
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}

      {collapsed && isUtilityPageActive && (
        <div className="hidden md:flex fixed left-0 top-0 h-full z-40 items-start pt-4 pl-5 border-l border-border/0">
          <div className="flex items-center gap-1">
            <Flower className="size-6 text-logo" />
            <Button
              variant="ghost"
              size="icon"
              onClick={onExpand}
              title="Expand sidebar"
            >
              <PanelLeft className="h-5 w-5" />
            </Button>
          </div>
        </div>
      )}

      <div
        data-sidebar="open"
        className={cn(
          "fixed inset-0 z-50 bg-background dark:bg-card flex flex-col h-[100dvh] select-none",
          "md:relative md:inset-auto md:w-[var(--sidebar-width)] md:mr-0 md:h-[calc(100dvh-16px)] md:my-2 md:ml-2 md:border md:border-border md:rounded-2xl",
          open ? "flex" : "hidden md:flex",
          collapsed && "md:hidden"
        )}
        style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      >
        <div className="px-[5px] h-[64px] max-h-[64px] md:h-[55px] md:max-h-[55px] border-b grid grid-cols-[40px_minmax(0,1fr)_40px] items-center md:px-[7px] md:pl-3 md:flex md:justify-between">
          <div className="md:hidden">
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-lg hover:!border-border/0"
              onClick={onClose}
              title="Close sidebar"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
          <div className="flex items-center justify-self-center gap-2 md:justify-self-auto">
            <button
              type="button"
              onClick={onCollapse}
              title="Collapse sidebar"
              className="hidden md:flex group/sidebar-collapse relative items-center justify-center h-5 w-5 sm:h-6 sm:w-6"
            >
              <Flower className="absolute inset-0.5 h-4 w-4 sm:h-5 sm:w-5 text-logo transition-all duration-200 ease-out opacity-100 scale-100 group-hover/sidebar-collapse:opacity-0 group-hover/sidebar-collapse:scale-0" />
              <PanelLeft className="absolute inset-0 h-4 w-4 sm:h-6 sm:w-6 text-slate-500 dark:text-slate-400 transition-all duration-200 ease-out opacity-0 scale-0 group-hover/sidebar-collapse:opacity-100 group-hover/sidebar-collapse:scale-80 hover:opacity-50" />
            </button>
            <Flower className="h-5 w-5 sm:h-6 sm:w-6 text-logo md:hidden" />
            <button
              type="button"
              onClick={() => {
                navigate("/")
                onClose()
              }}
              className="font-logo text-base uppercase sm:text-md text-slate-600 transition-colors hover:text-foreground dark:text-slate-100"
              title="Go to main page"
            >
              {APP_NAME}
            </button>
          </div>
          <div className="flex items-center justify-self-end md:justify-self-auto">
            <Button
              variant="ghost"
              size="icon"
              onClick={openAddProject}
              className="size-10 rounded-lg hover:!border-border/0 md:hidden"
              title="New project"
            >
              <Plus className="h-5 w-5" />
            </Button>
            {showDevBadge ? (
              <span
                className="mr-1 hidden md:inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-bold tracking-wider text-muted-foreground"
                title="Development build"
              >
                DEV
              </span>
            ) : showUpdateButton ? (
              <Button
                variant="outline"
                size="sm"
                className="hidden md:inline-flex rounded-full !h-auto mr-1 py-0.5 px-2 bg-logo/20 hover:bg-logo text-logo border-logo/20 hover:text-foreground hover:border-logo/20 text-[11px] font-bold tracking-wider"
                onClick={onOpenChangelog}
                disabled={isUpdating}
                title={updateSnapshot?.latestVersion ? `Update to ${updateSnapshot.latestVersion}` : "Update Kanna"}
              >
                {isUpdating ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                UPDATE
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              onClick={openAddProject}
              className="hidden md:inline-flex size-10 rounded-lg hover:!border-border/0"
              title="New project"
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>

        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-hide"
          style={{
            WebkitOverflowScrolling: "touch",
            touchAction: "pan-y",
          }}
        >
          <div className="p-[7px]">
            {!hasVisibleChats && isConnecting ? (
              <div className="space-y-5 px-1 pt-3">
                {[0, 1, 2].map((section) => (
                  <div key={section} className="space-y-2 animate-pulse">
                    <div className="h-4 w-28 rounded bg-muted" />
                    <div className="space-y-1">
                      {[0, 1, 2].map((row) => (
                        <div key={row} className="flex items-center gap-2 rounded-md px-3 py-2">
                          <div className="h-3.5 w-3.5 rounded-full bg-muted" />
                          <div
                            className={cn(
                              "h-3.5 rounded bg-muted",
                              row === 0 ? "w-32" : row === 1 ? "w-40" : "w-28"
                            )}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {!hasVisibleChats && !isConnecting && !hasVisibleSidebarContent ? (
              <p className="text-sm text-slate-400 p-2 mt-6 text-center">No conversations yet</p>
            ) : null}

            <div className="space-y-1 pb-2">
              <SidebarActionRow
                icon={MessageCircle}
                label="General Chat"
                onClick={() => {
                  onCreateGeneralChat()
                  onClose()
                }}
              />
              {generalProjectGroups.map((group) => {
                const hasMore = group.olderChats.length > 0
                const isExpanded = expandedGroups.has(group.groupKey)
                return (
                  <div key={group.groupKey} className="space-y-[2px] pl-3">
                    {group.previewChats.map(renderChatRow)}
                    {hasMore && isExpanded ? (
                      <button
                        type="button"
                        onClick={() => toggleExpandedGroup(group.groupKey)}
                        className="flex w-full justify-center py-1 text-xs text-muted-foreground/60 transition-colors hover:text-foreground/60"
                      >
                        Hide older
                      </button>
                    ) : null}
                    {isExpanded ? group.olderChats.map(renderChatRow) : null}
                    {hasMore && !isExpanded ? (
                      <button
                        type="button"
                        onClick={() => toggleExpandedGroup(group.groupKey)}
                        className="flex w-full justify-center py-1 text-xs text-muted-foreground/60 transition-colors hover:text-foreground/60"
                      >
                        Show older
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>

            {machines.length > 0 ? (
              <div className="border-y border-border/60 py-2">
                <MachineSelector
                  machines={machines}
                  selectedMachineId={activeMachineId}
                  projectCounts={machineProjectCounts}
                  onSelectMachine={onSelectMachine}
                  onRenameMachine={onRenameMachine}
                  compact
                  className="px-0"
                  buttonClassName="h-8 w-full justify-start px-2 text-sm"
                />
              </div>
            ) : null}

            <div className="space-y-1 py-2">
              <SidebarActionRow
                icon={SquarePen}
                label="New chat"
                disabled={!canCreateChatInCurrentProject}
                onClick={handleCreateChatInCurrentProject}
              />
              <SidebarActionRow
                icon={Search}
                label="Search"
                onClick={() => setSearchDialogOpen(true)}
              />
              <SidebarActionRow
                icon={Plug}
                label="Plugins"
                onClick={() => setAssetDialog("plugins")}
              />
              <SidebarActionRow
                icon={Sparkles}
                label="Skills"
                onClick={() => setAssetDialog("skills")}
              />
            </div>

            <ProjectsPanelMenu
              canCreateChat={canCreateChatInCurrentProject}
              onCreateChat={handleCreateChatInCurrentProject}
              onAddProject={openAddProject}
              onShowHiddenProjects={() => {
                setHiddenProjectsDialogOpen(true)
              }}
            >
              <div>
                <SidebarPanelLabel>Projects</SidebarPanelLabel>
              </div>
            </ProjectsPanelMenu>
            <LocalProjectsSection
              projectGroups={activeMachineProjectGroups}
              editorLabel={editorLabel}
              onReorderGroups={handleReorderActiveMachineProjectGroups}
              collapsedSections={collapsedSections}
              expandedGroups={expandedGroups}
              onToggleSection={toggleSection}
              onToggleExpandedGroup={toggleExpandedGroup}
              renderChatRow={renderChatRow}
              onShowArchivedProject={setArchivedProjectId}
              onNewLocalChat={onCreateChat}
              onRenameProject={onRenameProject}
              onCopyPath={onCopyPath}
              onOpenExternalPath={onOpenExternalPath}
              onHideProject={onHideProject}
              isConnected={connectionStatus === "connected"}
            />
            {!isConnecting && activeMachineProjectGroups.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No projects on {activeMachine?.displayName ?? "this device"}.
              </p>
            ) : null}
          </div>
        </div>

        <div className="border-t border-border p-2">
            <button
            type="button"
            onClick={() => {
              navigate("/settings/general")
              onClose()
            }}
            className={cn(
              "w-full rounded-xl rounded-t-md border px-3 py-2 text-left transition-colors",
              isSettingsActive
                ? "bg-muted border-border"
                : "border-border/0 hover:bg-muted hover:border-border active:bg-muted/80"
            )}
          >
            <div className="flex items- justify-between gap-2">
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Settings</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{statusLabel}</span>
                {isConnecting ? (
                  <Loader2 className="h-2 w-2 animate-spin" />
                ) : (
                  <span className={cn("h-2 w-2 rounded-full", statusDotClass)} />
                )}
              </div>
            </div>
          </button>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
          title="Resize sidebar"
          className={cn(
            "hidden md:block absolute -right-1 top-3 bottom-3 z-20 w-2 cursor-col-resize rounded-full",
            "focus-visible:outline-none"
          )}
          onPointerDown={(event) => {
            event.preventDefault()
            resizeStartRef.current = {
              pointerX: event.clientX,
              width: sidebarWidth,
            }
            setIsResizingSidebar(true)
          }}
          onDoubleClick={() => {
            setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)
            persistSidebarWidth(DEFAULT_SIDEBAR_WIDTH)
          }}
          onKeyDown={(event) => {
            let nextWidth: number | null = null
            if (event.key === "ArrowLeft") nextWidth = sidebarWidth - 16
            else if (event.key === "ArrowRight") nextWidth = sidebarWidth + 16
            else if (event.key === "Home") nextWidth = MIN_SIDEBAR_WIDTH
            else if (event.key === "End") nextWidth = MAX_SIDEBAR_WIDTH
            else if (event.key === "Enter") nextWidth = DEFAULT_SIDEBAR_WIDTH
            if (nextWidth === null) return
            event.preventDefault()
            const clampedWidth = clampSidebarWidth(nextWidth)
            setSidebarWidth(clampedWidth)
            persistSidebarWidth(clampedWidth)
          }}
        />
      </div>

      <Dialog
        open={Boolean(archivedProject)}
        onOpenChange={(dialogOpen) => {
          if (!dialogOpen) setArchivedProjectId(null)
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Archived Chats</DialogTitle>
            <DialogDescription>
              {archivedProject?.localPath ?? ""}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-1">
            {archivedProject?.archivedChats?.length ? (
              archivedProject.archivedChats.map((chat) => (
                <button
                  key={chat.chatId}
                  type="button"
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/0 px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted"
                  onClick={() => {
                    onOpenArchivedChat(chat.chatId)
                    setArchivedProjectId(null)
                    onClose()
                  }}
                >
                  <span className="min-w-0 truncate text-sm">{chat.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatSidebarAgeLabel(getSidebarChatTimestamp(chat), nowMs)}
                  </span>
                </button>
              ))
            ) : (
              <p className="px-1 py-3 text-sm text-muted-foreground">No archived chats</p>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <Dialog
        open={hiddenProjectsDialogOpen}
        onOpenChange={(dialogOpen) => {
          setHiddenProjectsDialogOpen(dialogOpen)
          if (!dialogOpen) {
            setHiddenProjectsError(null)
            setRestoringHiddenProjectId(null)
          }
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Hidden Projects</DialogTitle>
            <DialogDescription>
              {activeMachine?.displayName ?? "Current device"}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-2">
            {hiddenProjectsError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {hiddenProjectsError}
              </div>
            ) : null}
            {hiddenProjectsLoading ? (
              <div className="flex items-center gap-2 px-1 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading hidden projects
              </div>
            ) : hiddenProjects.length > 0 ? (
              <div className="max-h-[55vh] space-y-1 overflow-y-auto">
                {hiddenProjects.map((project) => {
                  const hiddenAge = formatSidebarAgeLabel(project.hiddenAt, nowMs)
                  const isRestoring = restoringHiddenProjectId === project.id
                  return (
                    <div
                      key={project.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/0 px-3 py-2 transition-colors hover:border-border hover:bg-muted"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{project.title}</div>
                        <div className="truncate text-xs text-muted-foreground">{project.localPath}</div>
                        {hiddenAge ? (
                          <div className="text-[11px] text-muted-foreground/70">
                            {hiddenAge === "now" ? "Hidden just now" : `Hidden ${hiddenAge} ago`}
                          </div>
                        ) : null}
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={Boolean(restoringHiddenProjectId)}
                        onClick={() => void handleRestoreHiddenProject(project)}
                        className="shrink-0 gap-1.5"
                      >
                        {isRestoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                        Restore
                      </Button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="px-1 py-3 text-sm text-muted-foreground">
                No hidden projects on {activeMachine?.displayName ?? "this device"}.
              </p>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <Dialog
        open={searchDialogOpen}
        onOpenChange={(dialogOpen) => {
          setSearchDialogOpen(dialogOpen)
          if (!dialogOpen) setSidebarSearchQuery("")
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Search</DialogTitle>
            <DialogDescription>
              {activeMachine?.displayName ?? "Current device"} projects and chats
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <input
              autoFocus
              value={sidebarSearchQuery}
              onChange={(event) => setSidebarSearchQuery(event.target.value)}
              placeholder="Search chats and projects"
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
            />
            {sidebarSearchQuery.trim() ? (
              sidebarSearchResults.length > 0 ? (
                <div className="max-h-[55vh] space-y-1 overflow-y-auto">
                  {sidebarSearchResults.map((result) => (
                    <button
                      key={result.key}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/0 px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted"
                      onClick={() => {
                        if (result.kind === "chat") {
                          navigate(`/chat/${result.chatId}`)
                        } else {
                          onCreateChat(result.projectId)
                        }
                        setSearchDialogOpen(false)
                        setSidebarSearchQuery("")
                        onClose()
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{result.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{result.subtitle}</span>
                      </span>
                      <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground/70">
                        {result.kind === "chat" ? "Chat" : "Project"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="px-1 py-3 text-sm text-muted-foreground">No results found.</p>
              )
            ) : (
              <p className="px-1 py-3 text-sm text-muted-foreground">
                Search project names, paths, and chat titles.
              </p>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      <Dialog
        open={assetDialog !== null}
        onOpenChange={(dialogOpen) => {
          if (!dialogOpen) {
            setAssetDialog(null)
            setCodexAssetsError(null)
          }
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle>{assetDialog === "plugins" ? "Plugins" : "Skills"}</DialogTitle>
                <DialogDescription>
                  {activeMachine?.displayName ?? "Current device"} Codex assets
                </DialogDescription>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={codexAssetsLoading}
                onClick={() => void loadCodexAssets()}
                className="shrink-0 gap-1.5"
              >
                {codexAssetsLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Refresh
              </Button>
            </div>
          </DialogHeader>
          <DialogBody className="space-y-3">
            {codexAssetsError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {codexAssetsError}
              </div>
            ) : null}
            {activeCodexAssets?.warnings?.length ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {activeCodexAssets.warnings.slice(0, 3).join(" ")}
              </div>
            ) : null}
            {codexAssetsLoading && !activeCodexAssets ? (
              <div className="flex items-center gap-2 px-1 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Scanning Codex assets
              </div>
            ) : assetDialog === "plugins" ? (
              activeCodexAssets?.plugins.length ? (
                <div className="max-h-[58vh] space-y-1 overflow-y-auto">
                  {activeCodexAssets.plugins.map((plugin) => (
                    <PluginAssetRow key={`${plugin.source}:${plugin.manifestPath ?? plugin.path}:${plugin.name}`} plugin={plugin} />
                  ))}
                </div>
              ) : (
                <p className="px-1 py-3 text-sm text-muted-foreground">
                  No Codex plugins found on {activeMachine?.displayName ?? "this device"}.
                </p>
              )
            ) : activeCodexAssets?.skills.length ? (
              <div className="max-h-[58vh] space-y-1 overflow-y-auto">
                {activeCodexAssets.skills.map((skill) => (
                  <SkillAssetRow key={`${skill.scope}:${skill.path}:${skill.name}`} skill={skill} />
                ))}
              </div>
            ) : (
              <p className="px-1 py-3 text-sm text-muted-foreground">
                No Codex skills found on {activeMachine?.displayName ?? "this device"}.
              </p>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      {open ? <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={onClose} /> : null}
    </>
  )
}

export const KannaSidebar = memo(KannaSidebarImpl)
