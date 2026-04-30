export async function copyTextToClipboard(text: string) {
  let asyncClipboardError: unknown = null
  const canUseAsyncClipboard = typeof window !== "undefined"
    && window.isSecureContext
    && typeof navigator !== "undefined"
    && navigator.clipboard?.writeText

  if (canUseAsyncClipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (error) {
      asyncClipboardError = error
      // Fall back for LAN/http contexts where the async Clipboard API is blocked.
    }
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard is not available")
  }

  if (copyWithCopyEvent(text)) return
  if (copyWithTemporarySelection(text)) return

  if (asyncClipboardError instanceof Error) {
    throw asyncClipboardError
  }
  throw new Error("Clipboard is not available")
}

function copyWithCopyEvent(text: string) {
  if (typeof document.execCommand !== "function") return false

  let wroteClipboardData = false
  const handleCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return
    event.clipboardData.setData("text/plain", text)
    event.preventDefault()
    wroteClipboardData = true
  }

  document.addEventListener("copy", handleCopy)
  try {
    return document.execCommand("copy") && wroteClipboardData
  } finally {
    document.removeEventListener("copy", handleCopy)
  }
}

function copyWithTemporarySelection(text: string) {
  if (typeof document.execCommand !== "function") return false

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "absolute"
  textarea.style.left = "-9999px"
  textarea.style.top = `${typeof window === "undefined" ? 0 : window.scrollY}px`
  document.body.appendChild(textarea)

  try {
    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, text.length)
    return document.execCommand("copy")
  } finally {
    textarea.remove()
  }
}
