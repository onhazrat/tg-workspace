export function triggerJsonlFilePicker(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".jsonl,application/jsonl"
    input.style.display = "none"
    input.onchange = () => {
      const file = input.files?.[0] ?? null
      document.body.removeChild(input)
      resolve(file)
    }
    document.body.appendChild(input)
    input.click()
  })
}
