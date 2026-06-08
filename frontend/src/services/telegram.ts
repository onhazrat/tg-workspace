import { Channel, Post, NetworkLog } from "../types";
import { api } from "../api/client";
import { saveNetworkLog } from "../lib/db";

export interface ScrapeResponse {
  posts: Post[];
  latestId?: number;
  displayName?: string;
  photoUrl?: string;
  bio?: string;
  subscribers?: string;
  photos?: string;
  videos?: string;
  files?: string;
  links?: string;
  error?: string;
  fullRequest?: any;
  fullResponse?: any;
  telemetry?: any[];
}

export class TelegramServiceError extends Error {
  constructor(
    message: string, 
    public status?: number, 
    public isRateLimited?: boolean, 
    public fullRequest?: any, 
    public fullResponse?: any, 
    public telemetry?: any[],
    public isUnavailableOnWebView?: boolean
  ) {
    super(message);
    this.name = "TelegramServiceError";
  }
}

const logTelemetry = async (url: string, method: string, status: number, telemetryData: any, source: string) => {
  if (!telemetryData) return;
  
  const logsToSave: any[] = Array.isArray(telemetryData) ? telemetryData : [telemetryData];
  
  for (const t of logsToSave) {
    if (!t) continue;
    const logEntry: NetworkLog = {
      id: crypto.randomUUID(),
      url,
      method,
      status: t.success ? "success" : "failed",
      statusCode: status,
      duration: t.totalDuration || 0,
      source,
      timestamp: Date.now(),
      proxyUsed: t.attempts?.[t.attempts.length - 1]?.proxyUrl,
      attempts: t.attempts?.length || 1,
      telemetry: t
    };
    try {
      await saveNetworkLog(logEntry);
    } catch (e) {
      console.error("Failed to save network log:", e);
    }
  }
};

export const scrapeTelegramChannel = async (
  channelName: string,
  startId: number,
  knownLatestId?: number,
  knownDisplayName?: string,
  knownPhotoUrl?: string,
  proxyEnabled?: boolean,
  proxies?: string[],
  torAutoRotate?: boolean,
  torRotationThreshold?: number,
  torControlPort?: number,
  _torControlPassword?: string,
  customUrl?: string
): Promise<ScrapeResponse> => {
  console.log(`[TelegramService] Scraping @${channelName} starting from ID: ${startId}...`);
  const scrapeUrl = customUrl || `https://t.me/s/${channelName}/${startId}`;
  const requestBody = {
    url: scrapeUrl,
    knownLatestId: knownLatestId > 0 ? knownLatestId : undefined,
    knownDisplayName: knownLatestId > 0 ? knownDisplayName : undefined,
    knownPhotoUrl: knownLatestId > 0 ? knownPhotoUrl : undefined,
    proxyEnabled,
    proxies,
    torAutoRotate,
    torRotationThreshold,
    torControlPort,
  };

  let data: ScrapeResponse;
  try {
    data = (await api.scrape(requestBody)) as ScrapeResponse;
  } catch (error) {
    const message = error instanceof Error ? error.message : `Network error while syncing ${channelName}`;
    throw new TelegramServiceError(message, undefined, false, requestBody);
  }

  if (data.telemetry) {
    logTelemetry(scrapeUrl, "GET", 200, data.telemetry, "Scraper");
  }

  return {
    ...data,
    fullRequest: requestBody,
    fullResponse: data,
  };
};

export const resolveStartTimeToId = async (
  channelName: string,
  targetTimeMs: number,
  proxyEnabled?: boolean,
  proxies?: string[],
  torAutoRotate?: boolean,
  torRotationThreshold?: number,
  torControlPort?: number,
  torControlPassword?: string
): Promise<number> => {
  if (isNaN(targetTimeMs)) {
    console.warn(`[TelegramService] Invalid targetTimeMs for @${channelName}. Defaulting to 1.`);
    return 1;
  }

  console.log(`[TelegramService] Resolving start time ${new Date(targetTimeMs).toISOString()} for @${channelName}...`);

  const fetchChannelInfo = async (): Promise<{
    latestId?: number;
    isUnavailableOnWebView?: boolean;
    telemetry?: unknown;
  }> => {
    return api.channelInfo({
      channelName,
      proxyEnabled,
      proxies,
      torAutoRotate,
      torRotationThreshold,
      torControlPort,
    }) as Promise<{
      latestId?: number;
      isUnavailableOnWebView?: boolean;
      telemetry?: unknown;
    }>;
  };

  const fetchPostHelper = async (id: number, url: string, pickLast: boolean): Promise<{ id: number, time: number } | null> => {
    try {
      const res = await scrapeTelegramChannel(
        channelName, id, id, undefined, undefined,
        proxyEnabled, proxies, torAutoRotate, torRotationThreshold, torControlPort, torControlPassword,
        url
      );
      if (res.posts && res.posts.length > 0) {
        const post = pickLast ? res.posts[res.posts.length - 1] : res.posts[0];
        const time = post.date ? new Date(post.date).getTime() : NaN;
        if (!isNaN(time)) return { id: post.id, time };
      }
      return null;
    } catch (e) {
      console.warn(`[TelegramService] Failed to fetch post at ID ${id}:`, e);
      return null;
    }
  };

  const fetchPostAtOrAfter = (id: number) => {
    if (id > 1) {
      return fetchPostHelper(id, `https://t.me/s/${channelName}?after=${id - 1}`, false);
    } else {
      return fetchPostHelper(id, `https://t.me/s/${channelName}?after=${id}`, false);
    }
  };
  
  const fetchPostAtOrBefore = (id: number) => 
    fetchPostHelper(id, `https://t.me/s/${channelName}?before=${id + 1}`, true);

  // Step 1: Find Bounds
  const info = await fetchChannelInfo();
  if (info.isUnavailableOnWebView) {
    throw new TelegramServiceError("Channel is not available on the web view.", 400, false, null, info, info.telemetry as any, true);
  }
  
  const latestId = info.latestId;
  if (!latestId) throw new Error("Could not determine latest ID for channel");

  let highId = latestId;
  let highTime = Date.now();
  const highPost = await fetchPostAtOrBefore(highId);
  if (highPost) {
    highId = highPost.id;
    highTime = highPost.time;
  }

  if (targetTimeMs >= highTime) {
    console.log(`[TelegramService] Target time is newer than latest post. Returning latest ID: ${highId}`);
    return highId;
  }

  let lowId = 1;
  let lowTime = 0;
  const lowPost = await fetchPostAtOrAfter(lowId);
  if (lowPost) {
    lowId = lowPost.id;
    lowTime = lowPost.time;
  } else {
    return 1;
  }

  if (targetTimeMs <= lowTime) {
    console.log(`[TelegramService] Target time is older than oldest post. Returning oldest ID: ${lowId}`);
    return lowId;
  }

  console.log(`[TelegramService] Bounds found: Low[${lowId}] = ${new Date(lowTime).toISOString()}, High[${highId}] = ${new Date(highTime).toISOString()}`);

  // Step 2: Hybrid Search (Interpolation + Binary)
  let iterations = 0;
  const MAX_ITERATIONS = 12;
  let bestId = lowId;

  while (lowId <= highId && iterations < MAX_ITERATIONS) {
    iterations++;
    
    // Interpolation
    let guessId = lowId + Math.floor(((targetTimeMs - lowTime) / (highTime - lowTime)) * (highId - lowId));
    
    // Fallback to binary search if interpolation is out of bounds or stuck
    if (guessId <= lowId || guessId >= highId || isNaN(guessId)) {
      guessId = Math.floor((lowId + highId) / 2);
    }

    console.log(`[TelegramService] Iteration ${iterations}: Guessing ID ${guessId} (Low: ${lowId}, High: ${highId})`);

    // Add a small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 800));

    const guessPost = await fetchPostAtOrAfter(guessId);
    if (!guessPost) {
      console.warn(`[TelegramService] Could not fetch post around guess ID ${guessId}. Assuming guess is beyond latest ID.`);
      highId = guessId - 1;
      continue;
    }

    console.log(`[TelegramService] Guessed Post: ID ${guessPost.id}, Time ${new Date(guessPost.time).toISOString()}`);

    if (guessPost.time === targetTimeMs) {
      bestId = guessPost.id;
      break;
    } else if (guessPost.time < targetTimeMs) {
      lowId = guessPost.id + 1;
      lowTime = guessPost.time;
      // We are still before the target, so bestId might be the next one we find
    } else {
      highId = guessId - 1;
      highTime = guessPost.time;
      bestId = guessPost.id; // Keep track of the first post found that is AFTER the target time
    }
  }

  console.log(`[TelegramService] Resolved start time to ID: ${bestId} after ${iterations} iterations.`);
  return bestId;
};

export interface PublishResult {
  success: boolean;
  error?: string;
  responses?: any[];
  requests?: any[];
}

export const publishSummary = async (
  token: string, 
  chatId: string, 
  text: string,
  metadataText?: string,
  proxyEnabled?: boolean,
  proxies?: string[],
  torAutoRotate?: boolean,
  torRotationThreshold?: number,
  torControlPort?: number,
  torControlPassword?: string
): Promise<PublishResult> => {
  try {
    const requestBody = {
      token,
      chatId,
      text,
      metadataText,
      proxyEnabled,
      proxies,
      torAutoRotate,
      torRotationThreshold,
      torControlPort,
    };

    const data = (await api.publish(requestBody)) as {
      success?: boolean;
      results?: unknown[];
      telemetry?: unknown;
      error?: string;
    };

    if (data.telemetry) {
      logTelemetry(`https://api.telegram.org/bot${token}/sendMessage`, "POST", 200, data.telemetry, "Publisher");
    }

    return {
      success: true,
      responses: data.results,
      requests: [requestBody],
    };
  } catch (err) {
    return { 
      success: false, 
      error: err instanceof Error ? err.message : String(err),
      responses: [],
      requests: []
    };
  }
};
