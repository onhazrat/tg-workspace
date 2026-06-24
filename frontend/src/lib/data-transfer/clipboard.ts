import { toast } from "sonner"

export async function copyTextToClipboard(
  text: string,
  successMessage = "Copied to clipboard",
): Promise<boolean> {
  if (!navigator?.clipboard) {
    toast.error("Clipboard not supported in this browser")
    return false
  }

  try {
    await navigator.clipboard.writeText(text)
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
