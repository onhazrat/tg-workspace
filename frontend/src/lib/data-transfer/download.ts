import { formatDateToLocalISO } from "@/lib/utils"

export interface SaveFileResult {
  fileHandle?: FileSystemFileHandle
  useBlobFallback: boolean
}

export function buildTimestampedFilename(prefix: string): string {
  const stamp = formatDateToLocalISO(new Date())
    .replace("T", "_")
    .replace(/:/g, "-")
  return `${prefix}-${stamp}.jsonl`
}

function shouldUseBlobDownloadFallback(): boolean {
  if (typeof navigator === "undefined") return true
  if (navigator.webdriver) return true
  return false
}

export async function pickSaveFile(
  suggestedName: string,
): Promise<SaveFileResult> {
  if (shouldUseBlobDownloadFallback()) {
    return { useBlobFallback: true }
  }

  try {
    const fileHandle = await (
      window as Window & {
        showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>
      }
    ).showSaveFilePicker?.({
      suggestedName,
      types: [
        {
          description: "JSON Lines File",
          accept: { "application/jsonl": [".jsonl"] },
        },
      ],
    })
    if (fileHandle) {
      return { fileHandle, useBlobFallback: false }
    }
    return { useBlobFallback: true }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err
    }
    return { useBlobFallback: true }
  }
}

export async function writeJsonlToFile(
  content: string,
  suggestedName: string,
): Promise<boolean> {
  const { fileHandle, useBlobFallback } = await pickSaveFile(suggestedName)

  if (fileHandle && !useBlobFallback) {
    const writable = await fileHandle.createWritable()
    await writable.write(content)
    await writable.close()
    return true
  }

  downloadJsonlBlob(content, suggestedName)
  return true
}

export function downloadJsonlBlob(content: string, filename: string): void {
  const blob = new Blob([content], { type: "application/jsonl" })
  downloadBlob(blob, filename)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
