import { toast } from "sonner"

function shouldUseClipboardFallback(): boolean {
  if (typeof navigator === "undefined") return true
  if (navigator.webdriver) return true
  return false
}

function copyTextWithExecCommand(text: string): boolean {
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  document.body.removeChild(textarea)
  return copied
}

async function writeTextToClipboard(text: string): Promise<boolean> {
  if (shouldUseClipboardFallback()) {
    if (copyTextWithExecCommand(text)) return true
  }

  if (!navigator?.clipboard) return false

  await navigator.clipboard.writeText(text)
  return true
}

export async function copyTextToClipboard(
  text: string,
  successMessage = "Copied to clipboard",
): Promise<boolean> {
  try {
    const copied = await writeTextToClipboard(text)
    if (!copied) {
      toast.error("Clipboard not supported in this browser")
      return false
    }
    toast.success(successMessage)
    return true
  } catch {
    toast.error("Failed to copy to clipboard")
    return false
  }
}

export function joinCopyLines(lines: string[]): string {
  return lines.join("\n")
}
