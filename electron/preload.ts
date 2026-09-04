import { contextBridge, ipcRenderer } from 'electron';

export interface ImageGenParams {
  model: string;
  prompt: string;
  aspectRatio: string;
  resolution?: string;
  image?: string;
  images?: string[];
  width?: number;
  height?: number;
  projectId?: string;
  category?: 'image' | 'adapt';
}

export interface VectorGenParams {
  prompt: string;
  aspectRatio: string;
  projectId?: string;
}

export interface VideoGenParams {
  model: string;
  prompt: string;
  image?: string;
  aspectRatio: string;
  duration: number;
  resolution: string;
  projectId?: string;
}

export interface VideoGenProParams {
  prompt: string;
  aspectRatio: string;
  duration: number;
  resolution: string;
  images?: string[];
  videos?: string[];
  audios?: string[];
  projectId?: string;
}

export interface ProjectFile {
  name: string;
  nodes: unknown[];
  edges: unknown[];
}

export interface WorkspaceFile {
  projects: { id: string; name: string; nodes: unknown[]; edges: unknown[] }[];
}

export interface AdaptPresetFormat {
  label: string;
  width: number;
  height: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ChatMode = 'assistant' | 'text';

export type MarketingAITask =
  | 'understandBusiness'
  | 'analyzeSegments'
  | 'analyzeJTBD'
  | 'proposePositioning'
  | 'proposeOffers'
  | 'analyzeChannels'
  | 'proposeCreativeStrategy'
  | 'designExperiments'
  | 'interpretResults'
  | 'explainRecommendation';

export interface MarketingAIResponse {
  result: unknown;
  schemaVersion: string;
  promptVersion: string;
  model?: string;
  mock?: boolean;
}

export interface BudgetUsage {
  costUsd: number;
  limit: number;
  month: string;
}

export interface ArchiveEntry {
  fileName: string;
  category: 'image' | 'video' | 'adapt' | 'vector';
  savedAt: number;
  url: string;
}

export interface AuthStatus {
  configured: boolean;
  email: string | null;
}

export interface SubscriptionInfo {
  configured: boolean;
  status: string | null;
  currentPeriodEnd: string | null;
}

export interface GenerationLogEntry {
  timestamp: number;
  model: string;
  category: 'image' | 'video' | 'adapt' | 'vector';
  costUsd: number;
}

export interface AdminMessage {
  id: string;
  body: string;
  createdAt: string;
}

export interface OnlineUser {
  email: string;
  lastSeen: string;
}

export type AdminMessageTarget = { mode: 'all' } | { mode: 'selected'; emails: string[] };

export interface AdminGenerationRecord {
  email: string;
  model: string;
  category: string;
  costUsd: number;
  createdAt: string;
}

export interface SubscriptionStatus {
  active: boolean;
  checkoutUrl: string;
}

const api = {
  getApiKey: (): Promise<string> => ipcRenderer.invoke('settings:get-api-key'),
  setApiKey: (key: string): Promise<boolean> => ipcRenderer.invoke('settings:set-api-key', key),
  generateImage: (params: ImageGenParams): Promise<string[]> =>
    ipcRenderer.invoke('generate:image', params),
  generateVideo: (params: VideoGenParams): Promise<string[]> =>
    ipcRenderer.invoke('generate:video', params),
  generateVideoPro: (params: VideoGenProParams): Promise<string[]> =>
    ipcRenderer.invoke('generate:video-pro', params),
  generateVector: (params: VectorGenParams): Promise<string[]> =>
    ipcRenderer.invoke('generate:vector', params),
  saveFile: (url: string, suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke('file:save', { url, suggestedName }),
  saveManyFiles: (files: { name: string; url: string }[]): Promise<string | null> =>
    ipcRenderer.invoke('file:save-many', { files }),
  fetchImageAsDataUrl: (url: string): Promise<string> =>
    ipcRenderer.invoke('image:fetch-as-data-url', url),
  pickImageFile: (): Promise<string | null> => ipcRenderer.invoke('image:pick-file'),
  pickMediaFile: (kind: 'video' | 'audio'): Promise<string | null> =>
    ipcRenderer.invoke('media:pick-file', kind),
  saveProjectFile: (project: ProjectFile): Promise<string | null> =>
    ipcRenderer.invoke('project:save', project),
  openProjectFile: (): Promise<ProjectFile | null> => ipcRenderer.invoke('project:open'),
  saveWorkspaceFile: (workspace: WorkspaceFile): Promise<string | null> =>
    ipcRenderer.invoke('workspace:save', workspace),
  openWorkspaceFile: (): Promise<WorkspaceFile | null> => ipcRenderer.invoke('workspace:open'),
  getAdaptPreset: (key: string): Promise<AdaptPresetFormat[]> =>
    ipcRenderer.invoke('presets:get-adapt', key),
  generateChat: (messages: ChatMessage[], images?: string[], mode?: ChatMode): Promise<string> =>
    ipcRenderer.invoke('generate:chat', messages, images, mode),
  marketingAI: (task: MarketingAITask, context: Record<string, unknown>, mock?: boolean): Promise<MarketingAIResponse> =>
    ipcRenderer.invoke('marketing:ai', task, context, mock),
  getUsage: (): Promise<BudgetUsage> => ipcRenderer.invoke('budget:get-usage'),
  setGenerationLimit: (limit: number): Promise<boolean> =>
    ipcRenderer.invoke('budget:set-limit', limit),
  listArchive: (projectId: string): Promise<ArchiveEntry[]> =>
    ipcRenderer.invoke('archive:list', projectId),
  openArchiveFolder: (projectId: string): Promise<boolean> =>
    ipcRenderer.invoke('archive:open-folder', projectId),
  getAuthStatus: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:get-status'),
  logout: (): Promise<boolean> => ipcRenderer.invoke('auth:logout'),
  openDsp: (): void => {
    ipcRenderer.send('dsp:open');
  },
  getSubscriptionInfo: (): Promise<SubscriptionInfo> =>
    ipcRenderer.invoke('auth:get-subscription-info'),
  getGenerationHistory: (): Promise<GenerationLogEntry[]> => ipcRenderer.invoke('history:get'),
  sendAdminMessage: (
    target: AdminMessageTarget,
    message: string
  ): Promise<{ ok: boolean; error?: string; count?: number }> =>
    ipcRenderer.invoke('admin:send-message', target, message),
  getPendingMessages: (): Promise<AdminMessage[]> => ipcRenderer.invoke('admin:get-pending-messages'),
  sendHeartbeat: (): Promise<void> => ipcRenderer.invoke('presence:heartbeat'),
  getOnlineUsers: (): Promise<OnlineUser[]> => ipcRenderer.invoke('admin:get-online-users'),
  getMechtaGenerations: (): Promise<AdminGenerationRecord[]> =>
    ipcRenderer.invoke('admin:get-mechta-generations'),
  getSubscriptionStatus: (): Promise<SubscriptionStatus> =>
    ipcRenderer.invoke('subscription:get-status'),
  // Not metered on desktop — generation runs on the user's own Replicate key (see
  // settings:get-api-key/set-api-key above), not the shared owner account the web build's
  // credit system funds.
  getCreditBalance: (): Promise<number> => Promise.resolve(Number.POSITIVE_INFINITY),
  getCheckoutUrl: (): Promise<string> => ipcRenderer.invoke('credit:get-checkout-url'),
  openCheckout: (url: string): void => {
    ipcRenderer.send('auth:open-checkout', url);
  },
};

contextBridge.exposeInMainWorld('api', api);

export type NodeApi = typeof api;
