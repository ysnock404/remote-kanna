import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ArrowUp, Paperclip } from "lucide-react"
import {
  type AgentProvider,
  type ChatAttachment,
  type ClaudeContextWindow,
  type ClaudeReasoningEffort,
  type CodexReasoningEffort,
  type ModelOptions,
  type ProviderCatalogEntry,
  normalizeClaudeContextWindow,
  resolveClaudeContextWindowTokens,
} from "../../../shared/types"
import { Button, buttonVariants } from "../ui/button"
import { Textarea } from "../ui/textarea"
import { ScrollArea } from "../ui/scroll-area"
import { cn, generateUUID } from "../../lib/utils"
import { useIsStandalone } from "../../hooks/useIsStandalone"
import { useChatInputStore } from "../../stores/chatInputStore"
import { NEW_CHAT_COMPOSER_ID, type ComposerState, useChatPreferencesStore } from "../../stores/chatPreferencesStore"
import { CHAT_INPUT_ATTRIBUTE, focusNextChatInput } from "../../app/chatFocusPolicy"
import { ChatPreferenceControls } from "./ChatPreferenceControls"
import { ContextWindowMeter } from "./ContextWindowMeter"
import { AttachmentFileCard, AttachmentImageCard } from "../messages/AttachmentCard"
import { AttachmentPreviewModal } from "../messages/AttachmentPreviewModal"
import { classifyAttachmentPreview } from "../messages/attachmentPreview"
import { overrideContextWindowMaxTokens, type ContextWindowSnapshot } from "../../lib/contextWindow"

const MAX_FILES_PER_DROP = 50
const MAX_CONCURRENT_UPLOADS = 3

const CLIPBOARD_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}
const CLIPBOARD_IMAGE_FILE_EXTENSIONS = new Set([".gif", ".jpeg", ".jpg", ".png", ".webp"])

export function willExceedAttachmentLimit(args: {
  currentAttachmentCount: number
  queuedAttachmentCount: number
  incomingAttachmentCount: number
  maxAttachments?: number
}) {
  const maxAttachments = args.maxAttachments ?? MAX_FILES_PER_DROP
  return args.currentAttachmentCount + args.queuedAttachmentCount + args.incomingAttachmentCount > maxAttachments
}

type ClipboardFileItem = Pick<DataTransferItem, "kind" | "type" | "getAsFile">
type ClipboardFileItems = Iterable<ClipboardFileItem> | ArrayLike<ClipboardFileItem>
type ClipboardFileList = Pick<DataTransfer, "files" | "items" | "getData">

function hasClipboardTextPayload(clipboardData: DataTransfer | null | undefined) {
  if (!clipboardData) return false
  return clipboardData.types.includes("text/plain") || clipboardData.types.includes("text/html")
}

function getClipboardImageExtension(file: File, fallbackMimeType?: string) {
  const mimeType = file.type || fallbackMimeType || ""
  const extension = CLIPBOARD_EXTENSION_BY_MIME_TYPE[mimeType]
  if (extension) return extension

  const fileExtension = getFileExtension(file.name)
  if (fileExtension && CLIPBOARD_IMAGE_FILE_EXTENSIONS.has(fileExtension)) {
    return fileExtension.slice(1)
  }

  return "bin"
}

function getFileExtension(fileName: string) {
  const match = fileName.trim().toLowerCase().match(/\.[a-z0-9]+$/)
  return match?.[0] ?? ""
}

function isClipboardImageFile(file: File, fallbackMimeType?: string) {
  return file.type.startsWith("image/")
    || Boolean(fallbackMimeType?.startsWith("image/"))
    || CLIPBOARD_IMAGE_FILE_EXTENSIONS.has(getFileExtension(file.name))
}

function isGenericClipboardImageName(file: File, fallbackMimeType?: string) {
  const normalized = file.name.trim().toLowerCase()
  if (!normalized) return true

  const expectedExtension = getClipboardImageExtension(file, fallbackMimeType)
  return normalized === `image.${expectedExtension}` || normalized === "image.png"
}

function normalizeClipboardImageFile(file: File, index: number, timestamp: number, fallbackMimeType?: string) {
  if (file.name && !isGenericClipboardImageName(file, fallbackMimeType)) return file

  const extension = getClipboardImageExtension(file, fallbackMimeType)
  const suffix = index === 0 ? "" : `-${index}`
  const fileName = `clipboard-${timestamp}${suffix}.${extension}`
  Object.defineProperty(file, "name", {
    configurable: true,
    value: fileName,
  })
  return file
}

function decodeHtmlAttributeValue(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
}

function createImageFileFromDataUrl(dataUrl: string, index: number, timestamp: number) {
  const commaIndex = dataUrl.indexOf(",")
  if (!dataUrl.startsWith("data:") || commaIndex < 0) return null

  const metadata = dataUrl.slice("data:".length, commaIndex)
  const mimeType = metadata.split(";")[0]?.toLowerCase() || "application/octet-stream"
  if (!mimeType.startsWith("image/")) return null

  const payload = dataUrl.slice(commaIndex + 1)
  const isBase64 = metadata.toLowerCase().split(";").includes("base64")
  let bytes: Uint8Array
  if (isBase64) {
    const binary = atob(payload)
    bytes = new Uint8Array(binary.length)
    for (let byteIndex = 0; byteIndex < binary.length; byteIndex += 1) {
      bytes[byteIndex] = binary.charCodeAt(byteIndex)
    }
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(payload))
  }

  const extension = CLIPBOARD_EXTENSION_BY_MIME_TYPE[mimeType] ?? "bin"
  const suffix = index === 0 ? "" : `-${index}`
  return new File([bytes], `clipboard-${timestamp}${suffix}.${extension}`, { type: mimeType })
}

export function getClipboardImageFilesFromHtml(html: string, timestamp: number) {
  if (!html.trim()) return []

  const files: File[] = []
  const imageSourcePattern = /<img\b[^>]*\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi
  let match: RegExpExecArray | null

  while ((match = imageSourcePattern.exec(html)) !== null) {
    const rawSource = match[1] ?? match[2] ?? match[3] ?? ""
    const source = decodeHtmlAttributeValue(rawSource.trim())
    if (!source.startsWith("data:image/")) continue
    const file = createImageFileFromDataUrl(source, files.length, timestamp)
    if (file) {
      files.push(file)
    }
  }

  return files
}

export function getClipboardImageFiles(items: ClipboardFileItems, timestamp: number) {
  const files: File[] = []

  for (const item of Array.from(items)) {
    if (!item || item.kind !== "file") continue
    const file = item.getAsFile()
    if (!file) continue
    if (!isClipboardImageFile(file, item.type)) continue
    files.push(normalizeClipboardImageFile(file, files.length, timestamp, item.type))
  }

  return files
}

export function getClipboardImageFilesFromDataTransfer(clipboardData: ClipboardFileList, timestamp: number) {
  const itemFiles = getClipboardImageFiles(clipboardData.items, timestamp)
  if (itemFiles.length > 0) {
    return itemFiles
  }

  const fileListFiles = Array.from(clipboardData.files)
    .filter((file) => isClipboardImageFile(file))
    .map((file, index) => normalizeClipboardImageFile(file, index, timestamp))
  if (fileListFiles.length > 0) {
    return fileListFiles
  }

  return getClipboardImageFilesFromHtml(clipboardData.getData("text/html"), timestamp)
}

async function getNavigatorClipboardImageFiles(timestamp: number) {
  if (typeof navigator === "undefined" || !navigator.clipboard?.read) {
    return null
  }

  const clipboardItems = await navigator.clipboard.read()
  const files: File[] = []
  for (const item of clipboardItems) {
    const imageType = item.types.find((type) => type.startsWith("image/"))
    if (!imageType) continue
    const blob = await item.getType(imageType)
    const extension = CLIPBOARD_EXTENSION_BY_MIME_TYPE[imageType] ?? "bin"
    const suffix = files.length === 0 ? "" : `-${files.length}`
    files.push(new File([blob], `clipboard-${timestamp}${suffix}.${extension}`, { type: imageType }))
  }
  return files
}

function summarizeClipboardData(clipboardData: DataTransfer) {
  const types = Array.from(clipboardData.types ?? [])
  const items = Array.from(clipboardData.items ?? []).map((item) => `${item.kind}:${item.type || "unknown"}`)
  const files = Array.from(clipboardData.files ?? []).map((file) => `${file.name || "unnamed"}:${file.type || "unknown"}:${file.size}`)
  return { types, items, files }
}

function hasImageLikeClipboardPayload(clipboardData: DataTransfer) {
  const summary = summarizeClipboardData(clipboardData)
  if (summary.types.some((type) => type.toLowerCase().includes("image"))) return true
  if (summary.items.some((item) => item.toLowerCase().includes("image"))) return true
  if (summary.files.length > 0) return true
  return /<img\b/i.test(clipboardData.getData("text/html"))
}

export function trimTrailingPastedNewlines(text: string) {
  return text.replace(/(?:\r\n|\r|\n)+$/, "")
}

function replaceTextSelection(args: {
  value: string
  insertedText: string
  selectionStart: number
  selectionEnd: number
}) {
  return `${args.value.slice(0, args.selectionStart)}${args.insertedText}${args.value.slice(args.selectionEnd)}`
}

interface ComposerAttachment extends ChatAttachment {
  status: "uploading" | "uploaded" | "failed"
  previewUrl?: string
}

interface Props {
  onSubmit: (
    value: string,
    options?: { provider?: AgentProvider; model?: string; modelOptions?: ModelOptions; planMode?: boolean; attachments?: ChatAttachment[] }
  ) => Promise<void>
  onLayoutChange?: () => void
  onCancel?: () => void
  disabled: boolean
  canCancel?: boolean
  chatId?: string | null
  projectId?: string | null
  inputElementRef?: React.Ref<HTMLTextAreaElement>
  activeProvider: AgentProvider | null
  availableProviders: ProviderCatalogEntry[]
  contextWindowSnapshot?: ContextWindowSnapshot | null
  previousPrompt?: string | null
}

export interface ChatInputHandle {
  enqueueFiles: (files: File[]) => void
}

function withNormalizedContextWindow(
  state: ComposerState,
  model: string
): ComposerState {
  if (state.provider !== "claude") return { ...state, model }
  return {
    ...state,
    model,
    modelOptions: {
      ...state.modelOptions,
      contextWindow: normalizeClaudeContextWindow(model, state.modelOptions.contextWindow),
    },
  }
}

function getEffectiveComposerState(
  composerState: ComposerState,
  activeProvider: AgentProvider | null,
  providerDefaults: ReturnType<typeof useChatPreferencesStore.getState>["providerDefaults"]
): ComposerState {
  if (!activeProvider || composerState.provider === activeProvider) {
    return composerState
  }

  return activeProvider === "claude"
    ? {
      provider: "claude",
      model: providerDefaults.claude.model,
      modelOptions: { ...providerDefaults.claude.modelOptions },
      planMode: composerState.planMode,
    }
    : {
      provider: "codex",
      model: providerDefaults.codex.model,
      modelOptions: { ...providerDefaults.codex.modelOptions },
      planMode: composerState.planMode,
    }
}

const ChatInputInner = forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSubmit,
  onLayoutChange,
  onCancel,
  disabled,
  canCancel,
  chatId,
  projectId,
  inputElementRef,
  activeProvider,
  availableProviders,
  contextWindowSnapshot = null,
  previousPrompt = null,
}, forwardedRef) {
  const {
    getDraft,
    setDraft,
    clearDraft,
    getAttachmentDrafts,
    setAttachmentDrafts,
    clearAttachmentDrafts,
  } = useChatInputStore()
  const {
    providerDefaults,
    getComposerState,
    initializeComposerForChat,
    setChatComposerModel,
    setChatComposerPlanMode,
    resetChatComposerFromProvider,
  } = useChatPreferencesStore()
  const composerChatId = chatId ?? NEW_CHAT_COMPOSER_ID
  const storedComposerState = useChatPreferencesStore((state) => state.chatStates[composerChatId])
  const composerState = storedComposerState ?? getComposerState(composerChatId)
  const [value, setValue] = useState(() => (chatId ? getDraft(chatId) : ""))
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isStandalone = useIsStandalone()
  const [attachments, setAttachments] = useState<ComposerAttachment[]>(() => hydrateComposerAttachments(chatId ? getAttachmentDrafts(chatId) : []))
  const [selectedAttachmentId, setSelectedAttachmentId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadQueueRef = useRef<File[]>([])
  const activeUploadsRef = useRef(0)
  const attachmentsRef = useRef<ComposerAttachment[]>([])
  const uploadGenerationRef = useRef(0)
  const removedAttachmentIdsRef = useRef<Set<string>>(new Set())
  const previousProjectIdRef = useRef<string | null>(projectId ?? null)
  const latestChatIdRef = useRef<string | null>(chatId ?? null)
  const lastPasteEventAtRef = useRef(0)

  const providerLocked = activeProvider !== null
  const providerPrefs = getEffectiveComposerState(composerState, activeProvider, providerDefaults)
  const selectedProvider = providerLocked ? activeProvider : composerState.provider
  const providerConfig = availableProviders.find((provider) => provider.id === selectedProvider) ?? availableProviders[0]
  const showPlanMode = providerConfig?.supportsPlanMode ?? false
  const activeContextWindow = useMemo(() => {
    if (providerPrefs.provider !== "claude") {
      return contextWindowSnapshot
    }

    const claudeModelOptions = providerPrefs.modelOptions as Extract<ComposerState, { provider: "claude" }>["modelOptions"]
    const stagedMaxTokens = resolveClaudeContextWindowTokens(
      normalizeClaudeContextWindow(providerPrefs.model, claudeModelOptions.contextWindow),
    )
    return overrideContextWindowMaxTokens(contextWindowSnapshot, stagedMaxTokens)
  }, [contextWindowSnapshot, providerPrefs.model, providerPrefs.modelOptions, providerPrefs.provider])
  const uploadedAttachments = attachments.filter((attachment) => attachment.status === "uploaded")
  const hasPendingUploads = attachments.some((attachment) => attachment.status === "uploading")
  const hasTextToSend = value.trim().length > 0
  const canSubmit = value.trim().length > 0 || uploadedAttachments.length > 0
  const orderedAttachments = [...attachments].sort((left, right) => {
    if (left.kind === right.kind) return 0
    return left.kind === "image" ? -1 : 1
  })
  const selectedAttachment = attachments.find((attachment) => attachment.id === selectedAttachmentId) ?? null

  const cleanupAttachmentPreview = useCallback((attachment: ComposerAttachment) => {
    if (attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl)
    }
  }, [])

  const clearAttachments = useCallback((options?: { cleanupPreviews?: boolean }) => {
    const cleanupPreviews = options?.cleanupPreviews ?? true
    uploadGenerationRef.current += 1
    removedAttachmentIdsRef.current.clear()
    setAttachments((current) => {
      if (cleanupPreviews) {
        current.forEach(cleanupAttachmentPreview)
      }
      return []
    })
    uploadQueueRef.current = []
    activeUploadsRef.current = 0
    setSelectedAttachmentId(null)
    setUploadError(null)
  }, [cleanupAttachmentPreview])

  const autoResize = useCallback(() => {
    const element = textareaRef.current
    if (!element) return
    if (element.value.length === 0) {
      element.style.height = ""
      return
    }
    element.style.height = "auto"
    element.style.height = `${element.scrollHeight}px`
  }, [])

  const setTextareaRefs = useCallback((node: HTMLTextAreaElement | null) => {
    textareaRef.current = node

    if (inputElementRef) {
      if (typeof inputElementRef === "function") {
        inputElementRef(node)
      } else {
        inputElementRef.current = node
      }
    }
  }, [inputElementRef])

  useLayoutEffect(() => {
    autoResize()
    onLayoutChange?.()
  }, [autoResize, onLayoutChange, value])

  useEffect(() => {
    const handleResize = () => {
      autoResize()
      onLayoutChange?.()
    }

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [autoResize, onLayoutChange])

  useLayoutEffect(() => {
    onLayoutChange?.()
  }, [attachments.length, onLayoutChange, uploadError])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [chatId])

  useEffect(() => {
    latestChatIdRef.current = chatId ?? null
  }, [chatId])

  useEffect(() => {
    initializeComposerForChat(composerChatId)
  }, [composerChatId, initializeComposerForChat])

  useEffect(() => {
    uploadGenerationRef.current += 1
    uploadQueueRef.current = []
    activeUploadsRef.current = 0
    removedAttachmentIdsRef.current.clear()
    setSelectedAttachmentId(null)
    setUploadError(null)
    setAttachments((current) => {
      current.forEach(cleanupAttachmentPreview)
      return hydrateComposerAttachments(chatId ? getAttachmentDrafts(chatId) : [])
    })
  }, [chatId, cleanupAttachmentPreview, getAttachmentDrafts])

  useEffect(() => {
    const previousProjectId = previousProjectIdRef.current
    previousProjectIdRef.current = projectId ?? null

    if (previousProjectId === null || projectId === previousProjectId) {
      return
    }

    clearAttachments()
    if (chatId) {
      clearAttachmentDrafts(chatId)
    }
  }, [projectId, chatId, clearAttachments, clearAttachmentDrafts])

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => {
    if (!chatId) return

    const persistedAttachments = attachments
      .filter((attachment) => attachment.status === "uploaded")
      .map(({ previewUrl: _previewUrl, status: _status, ...attachment }) => attachment)

    if (persistedAttachments.length === 0) {
      clearAttachmentDrafts(chatId)
      return
    }

    setAttachmentDrafts(chatId, persistedAttachments)
  }, [attachments, chatId, clearAttachmentDrafts, setAttachmentDrafts])

  useEffect(() => () => {
    attachmentsRef.current.forEach(cleanupAttachmentPreview)
  }, [cleanupAttachmentPreview])

  function updateComposerState(transform: (state: ComposerState) => ComposerState) {
    useChatPreferencesStore.getState().setComposerState(composerChatId, transform(providerPrefs))
  }

  function setReasoningEffort(reasoningEffort: string) {
    updateComposerState((state) => ({
      ...state,
      modelOptions: { ...state.modelOptions, reasoningEffort: reasoningEffort as ClaudeReasoningEffort & CodexReasoningEffort },
    } as ComposerState))
  }

  function setClaudeContextWindow(contextWindow: ClaudeContextWindow) {
    updateComposerState(
      (state) => state.provider !== "claude"
        ? state
        : withNormalizedContextWindow(
            { ...state, modelOptions: { ...state.modelOptions, contextWindow } },
            state.model
          )
    )
  }

  function setEffectivePlanMode(planMode: boolean) {
    setChatComposerPlanMode(composerChatId, planMode)
  }

  function toggleEffectivePlanMode() {
    setEffectivePlanMode(!providerPrefs.planMode)
  }

  const processUploadQueue = useCallback(() => {
    if (!projectId) return

    while (activeUploadsRef.current < MAX_CONCURRENT_UPLOADS && uploadQueueRef.current.length > 0) {
      const file = uploadQueueRef.current.shift()
      if (!file) break

      activeUploadsRef.current += 1
      const tempId = generateUUID()
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined
      const generation = uploadGenerationRef.current

      setAttachments((current) => [...current, {
        id: tempId,
        kind: file.type.startsWith("image/") ? "image" : "file",
        displayName: file.name,
        absolutePath: "",
        relativePath: "",
        contentUrl: "",
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        status: "uploading",
        previewUrl,
      }])

      void (async () => {
        try {
          const formData = new FormData()
          formData.append("files", file)

          const response = await fetch(`/api/projects/${projectId}/uploads`, {
            method: "POST",
            body: formData,
          })

          if (!response.ok) {
            const payload = await response.json().catch(() => ({}))
            throw new Error(typeof payload.error === "string" ? payload.error : "Upload failed")
          }

          const payload = await response.json() as { attachments: ChatAttachment[] }
          const uploaded = payload.attachments[0]
          if (!uploaded) {
            throw new Error("Upload failed")
          }

          if (generation !== uploadGenerationRef.current) {
            void deleteUploadedAttachment(uploaded)
            if (previewUrl) URL.revokeObjectURL(previewUrl)
            return
          }

          if (removedAttachmentIdsRef.current.has(tempId)) {
            removedAttachmentIdsRef.current.delete(tempId)
            if (previewUrl) URL.revokeObjectURL(previewUrl)
            void deleteUploadedAttachment(uploaded)
            return
          }

          setAttachments((current) => current.map((attachment) => (
            attachment.id !== tempId
              ? attachment
              : {
                  ...attachment,
                  ...uploaded,
                  previewUrl: attachment.previewUrl,
                  status: "uploaded",
                }
          )))
          setUploadError(null)
        } catch (error) {
          if (generation !== uploadGenerationRef.current) {
            if (previewUrl) URL.revokeObjectURL(previewUrl)
            return
          }
          setAttachments((current) => current.map((attachment) => (
            attachment.id === tempId ? { ...attachment, status: "failed" } : attachment
          )))
          setUploadError(error instanceof Error ? error.message : String(error))
        } finally {
          activeUploadsRef.current = Math.max(0, activeUploadsRef.current - 1)
          processUploadQueue()
        }
      })()
    }
  }, [projectId])

  const enqueueFiles = useCallback((files: File[]) => {
    if (!projectId) {
      setUploadError("Open a project before uploading files.")
      return
    }

    if (willExceedAttachmentLimit({
      currentAttachmentCount: attachmentsRef.current.length,
      queuedAttachmentCount: uploadQueueRef.current.length,
      incomingAttachmentCount: files.length,
    })) {
      setUploadError(`You can upload up to ${MAX_FILES_PER_DROP} files at a time.`)
      return
    }

    uploadQueueRef.current.push(...files)
    setUploadError(null)
    processUploadQueue()
  }, [processUploadQueue, projectId])

  const reportClipboardMiss = useCallback((clipboardData: DataTransfer) => {
    if (!hasImageLikeClipboardPayload(clipboardData)) return

    const summary = summarizeClipboardData(clipboardData)
    console.info("[ChatInput] Paste did not include uploadable image bytes", summary)
    setUploadError(`Paste detected, but the browser did not expose image bytes. Clipboard: ${summary.types.join(", ") || "unknown"}. Use the paperclip button if this keeps happening.`)
  }, [])

  const enqueueClipboardImages = useCallback((clipboardData: DataTransfer | null, options?: { reportMiss?: boolean }) => {
    if (!clipboardData) return false
    lastPasteEventAtRef.current = Date.now()

    const files = getClipboardImageFilesFromDataTransfer(clipboardData, Date.now())
    if (files.length === 0) {
      if (options?.reportMiss) {
        reportClipboardMiss(clipboardData)
      }
      return false
    }

    console.info("[ChatInput] Queuing pasted image attachments", { count: files.length, projectId })
    enqueueFiles(files)
    return true
  }, [enqueueFiles, projectId, reportClipboardMiss])

  const enqueueNavigatorClipboardImages = useCallback(async () => {
    if (disabled) return
    if (!projectId) {
      setUploadError("Open a project before uploading files.")
      return
    }

    try {
      const files = await getNavigatorClipboardImageFiles(Date.now())
      if (files === null) {
        setUploadError("Browser clipboard image read is unavailable. Use Ctrl+V or Cmd+V to paste images.")
        return
      }
      if (files.length === 0) {
        setUploadError("No image found in the clipboard.")
        return
      }

      console.debug("[ChatInput] Queuing clipboard image attachments", { count: files.length, projectId })
      enqueueFiles(files)
    } catch (error) {
      console.debug("[ChatInput] Clipboard image read failed:", error)
      setUploadError("Browser blocked clipboard image access. Use Ctrl+V or Cmd+V to paste images.")
    }
  }, [disabled, enqueueFiles, projectId])

  useEffect(() => {
    function handleWindowPaste(event: ClipboardEvent) {
      if (disabled || !event.clipboardData) return
      if (event.defaultPrevented) return
      if (enqueueClipboardImages(event.clipboardData, { reportMiss: true })) {
        event.preventDefault()
        event.stopPropagation()
      }
    }

    window.addEventListener("paste", handleWindowPaste, true)
    return () => window.removeEventListener("paste", handleWindowPaste, true)
  }, [disabled, enqueueClipboardImages])

  useImperativeHandle(forwardedRef, () => ({
    enqueueFiles,
  }), [enqueueFiles])

  async function handleSubmit() {
    if (!canSubmit || hasPendingUploads) return

    const nextValue = value
    const previousAttachments = attachmentsRef.current
    const previousSelectedAttachmentId = selectedAttachmentId
    const previousUploadError = uploadError
    const attachmentsForSubmit = uploadedAttachments.map(({ previewUrl: _previewUrl, status: _status, ...attachment }) => attachment)
    let modelOptions: ModelOptions
    if (providerPrefs.provider === "claude") {
      modelOptions = { claude: { ...providerPrefs.modelOptions } }
    } else {
      modelOptions = { codex: { ...providerPrefs.modelOptions } }
    }
    const submitOptions = {
      provider: selectedProvider,
      model: providerPrefs.model,
      modelOptions,
      planMode: showPlanMode ? providerPrefs.planMode : false,
      attachments: attachmentsForSubmit,
    }
    setValue("")
    if (chatId) clearDraft(chatId)
    if (textareaRef.current) textareaRef.current.style.height = "auto"
    clearAttachments({ cleanupPreviews: false })
    if (latestChatIdRef.current) {
      clearAttachmentDrafts(latestChatIdRef.current)
    }

    try {
      await onSubmit(nextValue, submitOptions)
      previousAttachments.forEach(cleanupAttachmentPreview)
    } catch (error) {
      console.error("[ChatInput] Submit failed:", error)
      setValue(nextValue)
      if (chatId) setDraft(chatId, nextValue)
      setAttachments(previousAttachments)
      setSelectedAttachmentId(previousSelectedAttachmentId)
      setUploadError(previousUploadError)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault()
      focusNextChatInput(textareaRef.current, document)
      return
    }

    if (event.key === "Tab" && event.shiftKey && showPlanMode) {
      event.preventDefault()
      toggleEffectivePlanMode()
      return
    }

    if (event.key === "Escape" && canCancel) {
      event.preventDefault()
      onCancel?.()
      return
    }

    if (event.key === "ArrowUp" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && value.length === 0 && previousPrompt) {
      event.preventDefault()
      setValue(previousPrompt)
      if (chatId) setDraft(chatId, previousPrompt)
      return
    }

    if (
      event.key.toLowerCase() === "v"
      && event.altKey
      && !event.ctrlKey
      && !event.metaKey
      && event.getModifierState?.("AltGraph") !== true
    ) {
      event.preventDefault()
      void enqueueNavigatorClipboardImages()
      return
    }

    if (
      event.key.toLowerCase() === "v"
      && (event.ctrlKey || event.metaKey)
      && !event.altKey
    ) {
      const shortcutAt = Date.now()
      window.setTimeout(() => {
        if (lastPasteEventAtRef.current >= shortcutAt) return
        setUploadError("Paste shortcut detected, but the browser did not send clipboard data. Click the chat input and try again, or use the paperclip button.")
      }, 500)
    }

    const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0
    if (event.key === "Enter" && !event.shiftKey && !isTouchDevice && !disabled && hasTextToSend && !hasPendingUploads) {
      event.preventDefault()
      void handleSubmit()
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const hasPastedImages = enqueueClipboardImages(event.clipboardData, { reportMiss: true })
    const pastedText = event.clipboardData.getData("text/plain")
    const trimmedText = trimTrailingPastedNewlines(pastedText)
    const shouldTrimTrailingNewlines = pastedText.length > 0 && trimmedText !== pastedText

    if (!hasPastedImages && !shouldTrimTrailingNewlines) return

    if (shouldTrimTrailingNewlines) {
      event.preventDefault()
      const textarea = event.currentTarget
      const nextValue = replaceTextSelection({
        value,
        insertedText: trimmedText,
        selectionStart: textarea.selectionStart,
        selectionEnd: textarea.selectionEnd,
      })
      const nextCaretPosition = textarea.selectionStart + trimmedText.length
      setValue(nextValue)
      if (chatId) setDraft(chatId, nextValue)
      autoResize()
      requestAnimationFrame(() => {
        textarea.selectionStart = nextCaretPosition
        textarea.selectionEnd = nextCaretPosition
      })
      return
    }

    if (hasPastedImages || !hasClipboardTextPayload(event.clipboardData)) {
      event.preventDefault()
    }
  }

  function handleBeforeInput(event: React.FormEvent<HTMLTextAreaElement>) {
    const nativeEvent = event.nativeEvent as InputEvent & { dataTransfer?: DataTransfer | null }
    if (nativeEvent.inputType !== "insertFromPaste" || !nativeEvent.dataTransfer) return

    if (enqueueClipboardImages(nativeEvent.dataTransfer, { reportMiss: true })) {
      event.preventDefault()
    }
  }

  function handleAttachmentPreview(attachment: ComposerAttachment) {
    const target = classifyAttachmentPreview(attachment)
    if (target.openInNewTab) {
      if (typeof window !== "undefined") {
        window.open(new URL(attachment.contentUrl, window.location.origin).toString(), "_blank", "noopener,noreferrer")
      }
      return
    }

    setSelectedAttachmentId(attachment.id)
  }

  function removeAttachment(attachment: ComposerAttachment) {
    removedAttachmentIdsRef.current.add(attachment.id)
    setAttachments((current) => {
      const removed = current.find((item) => item.id === attachment.id)
      if (removed) cleanupAttachmentPreview(removed)
      return current.filter((item) => item.id !== attachment.id)
    })
    if (selectedAttachmentId === attachment.id) {
      setSelectedAttachmentId(null)
    }

    if (attachment.status === "uploaded") {
      removedAttachmentIdsRef.current.delete(attachment.id)
      void deleteUploadedAttachment(attachment)
    }
  }

  return (
    <div>
      <div className={cn("px-3 pt-0", isStandalone && "px-5")}>
        <div className="max-w-[840px] mx-auto rounded-[32px]">
          {attachments.length > 0 ? (
            <ScrollArea className="overflow-x-auto overflow-y-hidden whitespace-nowrap px-2 pb-2">
              <div className="flex items-end gap-2 pt-2">
                {orderedAttachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className={cn("flex shrink-0 flex-col justify-end", attachment.status === "failed" && "text-destructive")}
                  >
                    {attachment.kind === "image" ? (
                      <AttachmentImageCard
                        attachment={attachment}
                        previewUrl={attachment.previewUrl}
                        size="composer"
                        onClick={attachment.status === "uploaded" ? () => handleAttachmentPreview(attachment) : undefined}
                        onRemove={() => removeAttachment(attachment)}
                      />
                    ) : (
                      <AttachmentFileCard
                        attachment={attachment}
                        onClick={attachment.status === "uploaded" ? () => handleAttachmentPreview(attachment) : undefined}
                        onRemove={() => removeAttachment(attachment)}
                      />
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : null}

          <div className="flex items-end max-w-[840px] mx-auto border dark:bg-card/40 backdrop-blur-lg border-border rounded-[29px] pr-1.5">
            <label
              aria-label="Add attachment"
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "relative flex-shrink-0 self-end ml-1 md:ml-1.5 mb-1 md:mb-1.5 h-10 w-10 md:h-11 md:w-11 rounded-full text-muted-foreground hover:text-foreground",
                disabled && "pointer-events-none opacity-50",
              )}
            >
              <Paperclip className="h-5 w-5" />
              <input
                type="file"
                multiple
                disabled={disabled}
                aria-label="Add attachment"
                className="absolute inset-0 cursor-pointer opacity-0"
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])]
                  if (files.length > 0) {
                    enqueueFiles(files)
                  }
                  event.target.value = ""
                }}
              />
            </label>
            <Textarea
              ref={setTextareaRefs}
              placeholder="Build something..."
              value={value}
              autoFocus
              {...{ [CHAT_INPUT_ATTRIBUTE]: "" }}
              rows={1}
              onChange={(event) => {
                setValue(event.target.value)
                if (chatId) setDraft(chatId, event.target.value)
                autoResize()
              }}
              onBeforeInput={handleBeforeInput}
              onPaste={handlePaste}
              onKeyDown={handleKeyDown}
              disabled={disabled}
              className="flex-1 text-base p-3 md:p-4 !pr-2 pl-1 md:pl-2 resize-none max-h-[200px] outline-none bg-transparent border-0 shadow-none"
            />
            <Button
              type="button"
              onPointerDown={(event) => {
                event.preventDefault()
                if (!disabled && hasTextToSend && !hasPendingUploads) {
                  void handleSubmit()
                } else if (canCancel) {
                  onCancel?.()
                } else if (!disabled && canSubmit && !hasPendingUploads) {
                  void handleSubmit()
                }
              }}
              disabled={disabled || (!canCancel && !canSubmit) || hasPendingUploads}
              size="icon"
              className="flex-shrink-0 bg-slate-600 text-white dark:bg-white dark:text-slate-900 rounded-full cursor-pointer h-10 w-10 md:h-11 md:w-11 mb-1 -mr-0.5 md:mr-0 md:mb-1.5 touch-manipulation disabled:bg-white/60 disabled:text-slate-700"
            >
              {hasTextToSend ? (
                <ArrowUp className="h-5 w-5 md:h-6 md:w-6" />
              ) : canCancel ? (
                <div className="w-3 h-3 md:w-4 md:h-4 rounded-xs bg-current" />
              ) : (
                <ArrowUp className="h-5 w-5 md:h-6 md:w-6" />
              )}
            </Button>
          </div>
        </div>

        {uploadError ? (
          <div className="max-w-[840px] mx-auto mt-2 px-1 text-sm text-destructive">
            {uploadError}
          </div>
        ) : null}
      </div>

      <div className={cn("relative py-3 max-w-[840px] mx-auto", isStandalone && "p-5 pt-3")}>
        <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex flex-row">
          <div className="min-w-3" />
          <ChatPreferenceControls
            availableProviders={availableProviders}
            selectedProvider={selectedProvider}
            providerLocked={providerLocked}
            showCodexCliRequirementHints
            model={providerPrefs.model}
            modelOptions={providerPrefs.modelOptions}
            onProviderChange={(provider) => {
              if (providerLocked) return
              resetChatComposerFromProvider(composerChatId, provider)
            }}
            onModelChange={(_, model) => {
              if (providerLocked) {
                updateComposerState((state) => withNormalizedContextWindow(state, model))
                return
              }
              setChatComposerModel(composerChatId, model)
            }}
            onModelOptionChange={(change) => {
              switch (change.type) {
                case "claudeReasoningEffort":
                  setReasoningEffort(change.effort)
                  break
                case "codexReasoningEffort":
                  setReasoningEffort(change.effort)
                  break
                case "contextWindow":
                  setClaudeContextWindow(change.contextWindow)
                  break
                case "fastMode":
                  updateComposerState(
                    (state) => state.provider === "claude"
                      ? state
                      : { ...state, modelOptions: { ...state.modelOptions, fastMode: change.fastMode } }
                  )
                  break
              }
            }}
            planMode={providerPrefs.planMode}
            onPlanModeChange={setEffectivePlanMode}
            includePlanMode={showPlanMode}
            className="max-w-[840px] mx-auto"
          />
          {activeContextWindow ? (
            <div className="flex items-center md:hidden mx-[13px]">
              <ContextWindowMeter usage={activeContextWindow} />
            </div>
          ) : null}
          <div className="min-w-3" />
        </div>

        {activeContextWindow ? (
          <div className="absolute right-[29px] top-1/2 translate-x-1/2 -translate-y-1/2 hidden md:block">
            <ContextWindowMeter usage={activeContextWindow} />
          </div>
        ) : null}
      </div>

      <AttachmentPreviewModal attachment={selectedAttachment} onOpenChange={(open) => !open && setSelectedAttachmentId(null)} />
    </div>
  )
})

export const ChatInput = memo(ChatInputInner)

async function deleteUploadedAttachment(attachment: ChatAttachment) {
  if (!attachment.contentUrl) return
  const deleteUrl = attachment.contentUrl.replace(/\/content$/, "")
  await fetch(deleteUrl, { method: "DELETE" }).catch(() => undefined)
}

function hydrateComposerAttachments(attachments: ChatAttachment[]): ComposerAttachment[] {
  return attachments.map((attachment) => ({
    ...attachment,
    status: "uploaded" as const,
  }))
}
