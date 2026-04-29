import process from "node:process"
import type {
  ChatRuntime,
  ChatSnapshot,
  KannaStatus,
  LocalProjectsSnapshot,
  MachineId,
  RemoteHostConfig,
  SidebarChatRow,
  SidebarData,
  SidebarProjectGroup,
} from "../shared/types"
import { getMachineLabel, getProjectLocationKey, LOCAL_MACHINE_ID, normalizeMachineId } from "../shared/project-location"
import { getRemoteMachineSummaries } from "./remote-hosts"
import type { ChatRecord, StoreState } from "./events"
import { resolveLocalPath } from "./paths"
import { SERVER_PROVIDERS } from "./provider-catalog"

const SIDEBAR_RECENT_WINDOW_MS = 24 * 60 * 60 * 1_000
const SIDEBAR_FALLBACK_PREVIEW_LIMIT = 5

export function deriveStatus(chat: ChatRecord, activeStatus?: KannaStatus): KannaStatus {
  if (activeStatus) return activeStatus
  if (chat.lastTurnOutcome === "failed") return "failed"
  return "idle"
}

function getSidebarChatSortTimestamp(chat: ChatRecord) {
  return chat.lastMessageAt ?? chat.createdAt
}

function canForkChat(
  chat: ChatRecord,
  activeStatuses: Map<string, KannaStatus>,
  drainingChatIds: Set<string>,
) {
  if (!chat.provider) return false
  if (!chat.sessionToken && !chat.pendingForkSessionToken) return false
  if (activeStatuses.has(chat.id)) return false
  if (drainingChatIds.has(chat.id)) return false
  return true
}

function getSidebarChatTimestamp(chat: Pick<SidebarChatRow, "lastMessageAt" | "_creationTime">) {
  return chat.lastMessageAt ?? chat._creationTime
}

function isSidebarChatRecent(chat: Pick<SidebarChatRow, "lastMessageAt" | "_creationTime">, nowMs: number) {
  return Math.max(0, nowMs - getSidebarChatTimestamp(chat)) < SIDEBAR_RECENT_WINDOW_MS
}

function getSidebarChatBuckets(chats: SidebarChatRow[], nowMs: number) {
  const recentChats = chats.filter((chat) => isSidebarChatRecent(chat, nowMs))
  const previewChats = recentChats.length > 0
    ? recentChats
    : chats.slice(0, Math.min(SIDEBAR_FALLBACK_PREVIEW_LIMIT, chats.length))
  const previewChatIds = new Set(previewChats.map((chat) => chat.chatId))

  return {
    previewChats,
    olderChats: chats.filter((chat) => !previewChatIds.has(chat.chatId)),
  }
}

export function deriveSidebarData(
  state: StoreState,
  activeStatuses: Map<string, KannaStatus>,
  options?: {
    nowMs?: number
    sidebarProjectOrder?: string[]
    drainingChatIds?: Set<string>
    remoteHosts?: RemoteHostConfig[]
    localMachineName?: string
  }
): SidebarData {
  const nowMs = options?.nowMs ?? Date.now()
  const drainingChatIds = options?.drainingChatIds ?? new Set<string>()
  const remoteHosts = options?.remoteHosts ?? []
  const localMachineName = options?.localMachineName ?? "Local"
  const chatsByProjectId = new Map<string, ChatRecord[]>()
  const archivedChatsByProjectId = new Map<string, ChatRecord[]>()
  for (const chat of state.chatsById.values()) {
    if (chat.deletedAt) continue
    const targetMap = chat.archivedAt ? archivedChatsByProjectId : chatsByProjectId
    const projectChats = targetMap.get(chat.projectId)
    if (projectChats) {
      projectChats.push(chat)
      continue
    }
    targetMap.set(chat.projectId, [chat])
  }

  const allProjects = [...state.projectsById.values()]
    .filter((project) => !project.deletedAt)
  const unorderedProjects = allProjects
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const projectById = new Map(unorderedProjects.map((project) => [project.id, project]))
  const orderedProjects = (options?.sidebarProjectOrder ?? [])
    .map((projectId) => projectById.get(projectId))
    .filter((project): project is NonNullable<typeof project> => Boolean(project))
  const orderedProjectIds = new Set(orderedProjects.map((project) => project.id))
  const projects = [
    ...orderedProjects,
    ...unorderedProjects.filter((project) => !orderedProjectIds.has(project.id)),
  ]

  function toSidebarChatRows(project: NonNullable<typeof projects[number]>, projectChats: ChatRecord[]) {
    const machineId = normalizeMachineId(project.machineId)
    return projectChats
      .sort((a, b) => getSidebarChatSortTimestamp(b) - getSidebarChatSortTimestamp(a))
      .map((chat) => ({
        _id: chat.id,
        _creationTime: chat.createdAt,
        chatId: chat.id,
        title: chat.title,
        status: deriveStatus(chat, activeStatuses.get(chat.id)),
        unread: chat.unread,
        machineId,
        machineLabel: getMachineLabel(machineId, remoteHosts, localMachineName),
        localPath: project.localPath,
        provider: chat.provider,
        lastMessageAt: chat.lastMessageAt,
        hasAutomation: false,
        canFork: canForkChat(chat, activeStatuses, drainingChatIds) || undefined,
      }))
  }

  const projectGroups: SidebarProjectGroup[] = projects.map((project) => {
    const machineId = normalizeMachineId(project.machineId)
    const chats = toSidebarChatRows(project, chatsByProjectId.get(project.id) ?? [])
    const archivedChats = toSidebarChatRows(project, archivedChatsByProjectId.get(project.id) ?? [])
    const { previewChats, olderChats } = getSidebarChatBuckets(chats, nowMs)

    return {
      groupKey: project.id,
      machineId,
      machineLabel: getMachineLabel(machineId, remoteHosts, localMachineName),
      localPath: project.localPath,
      chats,
      previewChats,
      olderChats,
      ...(archivedChats.length ? { archivedChats } : {}),
      defaultCollapsed: chats.every((chat) => !isSidebarChatRecent(chat, nowMs)),
    }
  })

  return { projectGroups }
}

export function deriveLocalProjectsSnapshot(
  state: StoreState,
  discoveredProjects: Array<{ machineId?: MachineId; localPath: string; title: string; modifiedAt: number }>,
  machineName: string,
  remoteHosts: RemoteHostConfig[] = []
): LocalProjectsSnapshot {
  const projects = new Map<string, LocalProjectsSnapshot["projects"][number]>()

  for (const project of discoveredProjects) {
    const machineId = project.machineId ?? LOCAL_MACHINE_ID
    const normalizedPath = machineId === LOCAL_MACHINE_ID ? resolveLocalPath(project.localPath) : project.localPath
    projects.set(getProjectLocationKey(machineId, normalizedPath), {
      machineId,
      machineLabel: getMachineLabel(machineId, remoteHosts, machineName),
      localPath: normalizedPath,
      title: project.title,
      source: "discovered",
      lastOpenedAt: project.modifiedAt,
      chatCount: 0,
    })
  }

  for (const project of [...state.projectsById.values()].filter((entry) => !entry.deletedAt)) {
    const machineId = normalizeMachineId(project.machineId)
    const chats = [...state.chatsById.values()].filter((chat) => chat.projectId === project.id && !chat.deletedAt && !chat.archivedAt)
    const lastOpenedAt = chats.reduce(
      (latest, chat) => Math.max(latest, getSidebarChatSortTimestamp(chat)),
      project.updatedAt
    )

    projects.set(getProjectLocationKey(machineId, project.localPath), {
      machineId,
      machineLabel: getMachineLabel(machineId, remoteHosts, machineName),
      localPath: project.localPath,
      title: project.title,
      source: "saved",
      lastOpenedAt,
      chatCount: chats.length,
    })
  }

  return {
    machine: {
      id: "local",
      displayName: machineName,
      platform: process.platform,
    },
    machines: [
      {
        id: "local",
        displayName: machineName,
        platform: process.platform,
        enabled: true,
      },
      ...getRemoteMachineSummaries(remoteHosts),
    ],
    projects: [...projects.values()].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)),
  }
}

export function deriveChatSnapshot(
  state: StoreState,
  activeStatuses: Map<string, KannaStatus>,
  drainingChatIds: Set<string>,
  chatId: string,
  getMessages: (chatId: string) => Pick<ChatSnapshot, "messages" | "history">,
  options?: {
    remoteHosts?: RemoteHostConfig[]
    localMachineName?: string
  }
): ChatSnapshot | null {
  const chat = state.chatsById.get(chatId)
  if (!chat || chat.deletedAt) return null
  const project = state.projectsById.get(chat.projectId)
  if (!project || project.deletedAt) return null

  const runtime: ChatRuntime = {
    chatId: chat.id,
    projectId: project.id,
    machineId: normalizeMachineId(project.machineId),
    machineLabel: getMachineLabel(normalizeMachineId(project.machineId), options?.remoteHosts ?? [], options?.localMachineName ?? "Local"),
    localPath: project.localPath,
    title: chat.title,
    status: deriveStatus(chat, activeStatuses.get(chat.id)),
    isDraining: drainingChatIds.has(chat.id),
    provider: chat.provider,
    planMode: chat.planMode,
    sessionToken: chat.sessionToken,
  }

  const transcript = getMessages(chat.id)

  return {
    runtime,
    queuedMessages: (state.queuedMessagesByChatId.get(chat.id) ?? []).map((entry) => ({
      ...entry,
      attachments: [...entry.attachments],
    })),
    messages: transcript.messages,
    history: transcript.history,
    availableProviders: [...SERVER_PROVIDERS],
  }
}
