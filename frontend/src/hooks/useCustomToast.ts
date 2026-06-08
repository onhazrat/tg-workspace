import { toast } from "sonner"

const useCustomToast = () => {
  const showSuccessToast = (description: string) => {
    toast.success("Success!", {
      description,
    })
  }

  const showErrorToast = (message: string) => {
    toast.error(message)
  }

  return { showSuccessToast, showErrorToast }
}

export default useCustomToast
