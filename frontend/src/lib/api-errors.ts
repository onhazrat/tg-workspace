const UNAVAILABLE_WEB_VIEW_MESSAGE = "Channel is not available on the web view."

export interface ParsedApiError {
  message: string
  isUnavailableOnWebView: boolean
}

export function isUnavailableWebViewMessage(message: string): boolean {
  return (
    message.includes(UNAVAILABLE_WEB_VIEW_MESSAGE) ||
    message.includes('"isUnavailableOnWebView":true')
  )
}

/** Parse FastAPI error bodies thrown by `request()` as `new Error(detail)`. */
export function parseApiError(err: unknown): ParsedApiError {
  if (!(err instanceof Error)) {
    return {
      message: "Request failed",
      isUnavailableOnWebView: false,
    }
  }

  try {
    const parsed = JSON.parse(err.message) as {
      error?: string
      isUnavailableOnWebView?: boolean
    }
    if (parsed && typeof parsed === "object") {
      const message = parsed.error ?? err.message
      return {
        message,
        isUnavailableOnWebView:
          parsed.isUnavailableOnWebView === true ||
          isUnavailableWebViewMessage(message),
      }
    }
  } catch {
    /* detail was a plain string */
  }

  return {
    message: err.message,
    isUnavailableOnWebView: isUnavailableWebViewMessage(err.message),
  }
}

export function unavailableChannelToastMessage(channelName: string): string {
  return `@${channelName} is not available on Telegram's public web view. It was added as Unavailable and syncing is disabled.`
}
