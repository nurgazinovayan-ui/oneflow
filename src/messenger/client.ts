// Thin client for the @mechta.kz-only messenger. All writes go through service-role Edge
// Functions (see supabase/functions/messenger-*), which re-validate the @mechta.kz domain and
// channel membership against the caller's own verified JWT — this module and the widget that
// uses it are just UX, not the security boundary. Web-only for now: it reuses webApi.ts's
// session/token-refresh logic, which Electron's window.api abstraction doesn't expose (the
// desktop build talks to Supabase from the main process, not the renderer).
import { getValidSession } from '../webApi';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export type MessengerStatus = 'idle' | 'generating' | 'copywriting' | 'evaluating';
export interface RosterEntry {
  email: string;
  displayName: string;
  status: MessengerStatus;
  online: boolean;
  isSelf: boolean;
}
export interface ChannelMember {
  email: string;
  displayName: string;
  status: MessengerStatus;
  online: boolean;
  isSelf: boolean;
}
export type MessageKind = 'text' | 'sticker' | 'gif';
export interface LastMessage {
  body: string;
  senderEmail: string;
  createdAt: string;
  kind: MessageKind;
  mediaUrl: string | null;
}
export interface ChannelSummary {
  id: string;
  kind: 'dm' | 'group';
  title: string;
  members: ChannelMember[];
  lastMessage: LastMessage | null;
}
export interface ChatMessage {
  id: string;
  senderEmail: string;
  body: string;
  createdAt: string;
  kind: MessageKind;
  mediaUrl: string | null;
}
export interface GifResult {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
}

async function call<T>(name: string, body: unknown): Promise<T> {
  const session = await getValidSession();
  if (!session) throw new Error('Not signed in.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.accessToken}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && typeof data.error === 'string' && data.error) || `Request failed (${res.status})`);
  return data as T;
}

export function heartbeat(displayName?: string, status?: MessengerStatus): Promise<{ ok: true }> {
  return call('messenger-heartbeat', { ...(displayName ? { displayName } : {}), ...(status ? { status } : {}) });
}
export function getRoster(): Promise<RosterEntry[]> {
  return call('messenger-roster', {});
}
export function listChannels(): Promise<ChannelSummary[]> {
  return call('messenger-list-channels', {});
}
export function startDm(otherEmail: string): Promise<{ id: string }> {
  return call('messenger-create-channel', { kind: 'dm', memberEmails: [otherEmail] });
}
export function createGroup(title: string, memberEmails: string[]): Promise<{ id: string }> {
  return call('messenger-create-channel', { kind: 'group', title, memberEmails });
}
export function listMessages(channelId: string, after?: string): Promise<ChatMessage[]> {
  return call('messenger-list-messages', after ? { channelId, after } : { channelId });
}
export function sendMessage(channelId: string, text: string): Promise<ChatMessage> {
  return call('messenger-send-message', { channelId, kind: 'text', text });
}
export function sendSticker(channelId: string, emoji: string): Promise<ChatMessage> {
  return call('messenger-send-message', { channelId, kind: 'sticker', text: emoji });
}
export function sendGif(channelId: string, url: string, caption = ''): Promise<ChatMessage> {
  return call('messenger-send-message', { channelId, kind: 'gif', mediaUrl: url, text: caption });
}
export function searchGifs(query: string): Promise<GifResult[]> {
  return call('messenger-gif-search', { query });
}
