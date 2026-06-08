export interface Post {
  id: number;
  channelName: string;
  text: string;
  date: string;
  timestamp: number;
  forwardedFrom?: string;
  forwardedFromName?: string;
}

export interface PostEmbedding {
  id: string; // e.g. `${channelName}_${postId}`
  channelName: string;
  postId: number;
  vector: number[];
  text: string;
}

export interface PostTranslation {
  id: string; // e.g. `${channelName}_${postId}_${language}`
  channelName: string;
  postId: number;
  language: string;
  translatedText: string;
  timestamp: number;
}

export interface Channel {
  id: string;
  name: string;
  displayName?: string;
  photoUrl?: string;
  bio?: string;
  subscribers?: string;
  photos?: string;
  videos?: string;
  files?: string;
  links?: string;
  startId?: number;
  startTime?: number;
  tags?: string[];
  lastUpdated?: number;
  isFrozen?: boolean;
  isUnavailableOnWebView?: boolean;
  language?: string;
  followedAt?: number;
  discoveredVia?: {
    channelName: string;
    postId: number;
    timestamp: number;
  };
}

export type GlobalStartTimeMode = "relative" | "absolute" | "retention";
export type GlobalStartTimeValue = number | string | null;

export interface BotCredential {
  id: string;
  name: string;
  /** Present only when creating or migrating; never returned by GET. */
  token?: string;
  hasToken?: boolean;
  username?: string;
  /** Telegram file path (e.g. photos/file.jpg) or legacy full URL. */
  photoUrl?: string;
  lastValidated?: number;
}

export interface ChatDestination {
  id: string;
  name: string;
  chatId: string;
}

export interface Summary {
  id: string;
  text: string;
  channels: string[];
  startDate: number;
  endDate: number;
  language: string;
  model?: string;
  postCount?: number;
  timestamp: number;
  chatMessages?: { role: "user" | "model"; text: string }[];
  autoRegenerate?: boolean;
  autoPublish?: boolean;
  publishBotId?: string;
  publishChatId?: string;
  note?: string;
  sendMetadata?: boolean;
  metadataText?: string;
  isStarred?: boolean;
  postSearch?: string;
  semanticSearchQuery?: string;
  semanticSearchRespectsTimeRange?: boolean;
  semanticSearchRespectsChannels?: boolean;
  citedPosts?: Record<string, Post>;
}

export interface PublishLog {
  id: string;
  summaryId: string;
  botId: string;
  botName: string;
  chatId: string;
  chatName: string;
  status: "success" | "failed";
  error?: string;
  timestamp: number;
  fullRequest?: any;
  fullResponse?: any;
  textSent?: string;
}

export interface SyncLog {
  id: string;
  channelName: string;
  status: "success" | "failed";
  postsCount: number;
  newLatestId?: number;
  error?: string;
  timestamp: number;
  source: string;
  fullRequest?: any;
  fullResponse?: any;
}

export interface LLMLog {
  id: string;
  model: string;
  prompt: string;
  response: string;
  systemInstruction?: string;
  modelConfig?: any;
  fullRequest?: any;
  fullResponse?: any;
  tokens?: number;
  duration?: number;
  status: "success" | "failed";
  error?: string;
  timestamp: number;
  type: "summary" | "chat" | "analysis" | "rag_chat";
}

export interface EmbeddingLog {
  id: string;
  textCount: number;
  tokensEstimated?: number;
  duration: number;
  status: "success" | "failed";
  error?: string;
  timestamp: number;
}

export interface NetworkLog {
  id: string;
  url: string;
  method: string;
  status: "success" | "failed";
  statusCode?: number;
  error?: string;
  duration: number;
  timestamp: number;
  source: string;
  proxyUsed?: string;
  attempts?: number;
  telemetry?: any;
}

export interface ChannelStats {
  count: number;
  minId: number;
  maxId: number;
  latestId?: number;
  velocity?: number; // Posts per hour
}

export interface SyncQueueItem {
  queueId: string;
  channel: Channel;
  source: string;
  timestamp: number;
  onComplete?: () => void;
}

export interface DBStats {
  postCount: number;
  channelCount: number;
  summaryCount: number;
  embeddedPostCount?: number;
  botCount?: number;
  destinationCount?: number;
  publishLogCount?: number;
  syncLogCount?: number;
  llmLogCount?: number;
  embeddingLogCount?: number;
  networkLogCount?: number;
  storageEstimate?: {
    usage?: number;
    quota?: number;
    usageDetails?: { [key: string]: number };
  };
  storeSizes?: Record<string, number>;
}

export type TabType = "summary" | "posts" | "channels" | "history" | "db" | "chat" | "bots" | "settings" | "logs";

export interface ChatMessage {
  role: "user" | "model";
  text: string;
  sources?: Post[];
}
