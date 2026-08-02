import { ApiError } from "./api/base"

function extractErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    // A 422 body carries `detail` as an array of per-field validation errors;
    // anything else has already been flattened to a string in `message`.
    const errDetail = (err.body as { detail?: string | { msg: string }[] })
      ?.detail
    if (Array.isArray(errDetail) && errDetail.length > 0) {
      return errDetail[0].msg
    }
    return err.message
  }

  if (err instanceof Error) {
    return err.message
  }

  return "Something went wrong."
}

export const handleError = function (
  this: (msg: string) => void,
  err: unknown,
) {
  const errorMessage = extractErrorMessage(err)
  this(errorMessage)
}

export const getInitials = (name: string): string => {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
}
