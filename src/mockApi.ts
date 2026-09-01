import type { NodeApi, GenerationLogEntry, AdminMessage, CreativeEvaluationResult, AudioGenParams } from './types';
import { estimateImageCost, estimateVideoCost, DSP_URL, ADMIN_EMAIL } from './types';
import { useLanguageStore, ru, en } from './i18n';

// Fallback implementation used only when running the renderer in a plain
// browser (e.g. `vite` dev preview) without the Electron preload bridge.
// Lets the node canvas be exercised visually without a real Electron shell.
function bumpMockUsage(costUsd: number): void {
  const month = new Date().toISOString().slice(0, 7);
  const storedMonth = localStorage.getItem('mock-usage-month');
  const total =
    (storedMonth === month ? Number(localStorage.getItem('mock-usage-cost') ?? '0') : 0) + costUsd;
  localStorage.setItem('mock-usage-month', month);
  localStorage.setItem('mock-usage-cost', String(total));
}

// A short, real, playable 440Hz beep — built at runtime rather than a hardcoded base64 blob, so
// there's something genuine for the audio player UI to load/play/seek during dev-mode testing.
function makeMockAudioDataUrl(): string {
  const sampleRate = 8000;
  const numSamples = Math.floor(sampleRate * 0.6);
  const buffer = new ArrayBuffer(44 + numSamples);
  const view = new DataView(buffer);
  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples, true);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    view.setUint8(44 + i, Math.sin(2 * Math.PI * 440 * t) * 60 + 128);
  }
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(binary);
}

function logMockGeneration(entry: GenerationLogEntry): void {
  try {
    const log: GenerationLogEntry[] = JSON.parse(localStorage.getItem('mock-generation-log') ?? '[]');
    log.push(entry);
    if (log.length > 2000) log.splice(0, log.length - 2000);
    localStorage.setItem('mock-generation-log', JSON.stringify(log));
  } catch {
    // Corrupt/oversized localStorage entry — drop silently rather than block generation.
  }
}

export function installMockApiIfNeeded(): void {
  if (typeof window.api !== 'undefined') return;

  const placeholderImage =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">' +
        '<rect width="100%" height="100%" fill="#1f3340"/>' +
        '<text x="50%" y="50%" fill="#8fd0e8" font-size="24" text-anchor="middle" dy=".3em">mock image</text>' +
        '</svg>'
    );

  const mock: NodeApi = {
    getApiKey: async () => localStorage.getItem('mock-api-key') ?? '',
    setApiKey: async (key: string) => {
      localStorage.setItem('mock-api-key', key);
      return true;
    },
    generateImage: async (params) => {
      await new Promise((r) => setTimeout(r, 800));
      const costUsd = estimateImageCost(params.model, params.resolution, 1);
      bumpMockUsage(costUsd);
      logMockGeneration({
        timestamp: Date.now(),
        model: params.model,
        category: params.category ?? 'image',
        costUsd,
      });
      return [placeholderImage];
    },
    generateVideo: async (params) => {
      await new Promise((r) => setTimeout(r, 800));
      const costUsd = estimateVideoCost(params.model, params.resolution, params.duration);
      bumpMockUsage(costUsd);
      logMockGeneration({ timestamp: Date.now(), model: params.model, category: 'video', costUsd });
      return [];
    },
    generateVideoPro: async (params) => {
      await new Promise((r) => setTimeout(r, 800));
      const costUsd = estimateVideoCost('bytedance/seedance-2.5', params.resolution, params.duration);
      bumpMockUsage(costUsd);
      logMockGeneration({
        timestamp: Date.now(),
        model: 'bytedance/seedance-2.5',
        category: 'video',
        costUsd,
      });
      return [];
    },
    generateVector: async () => {
      await new Promise((r) => setTimeout(r, 800));
      const vectorCost = estimateImageCost('recraft-ai/recraft-v4-svg', undefined, 1);
      bumpMockUsage(vectorCost);
      logMockGeneration({
        timestamp: Date.now(),
        model: 'recraft-ai/recraft-v4-svg',
        category: 'vector',
        costUsd: vectorCost,
      });
      const placeholderSvg =
        'data:image/svg+xml;utf8,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">' +
            '<rect width="100%" height="100%" fill="#1f3340"/>' +
            '<circle cx="256" cy="220" r="90" fill="#8fd0e8"/>' +
            '<text x="50%" y="90%" fill="#8fd0e8" font-size="24" text-anchor="middle">mock vector</text>' +
            '</svg>'
        );
      return [placeholderSvg];
    },
    saveFile: async () => null,
    saveManyFiles: async () => null,
    fetchImageAsDataUrl: async (url: string) => {
      if (url.startsWith('data:')) return url;
      const res = await fetch(url);
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    },
    pickImageFile: async () => {
      return await new Promise<string | null>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) {
            resolve(null);
            return;
          }
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        };
        input.click();
      });
    },
    pickMediaFile: async (kind: 'video' | 'audio') => {
      return await new Promise<string | null>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = kind === 'video' ? 'video/*' : 'audio/*';
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) {
            resolve(null);
            return;
          }
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        };
        input.click();
      });
    },
    saveProjectFile: async () => null,
    openProjectFile: async () => null,
    saveWorkspaceFile: async () => null,
    openWorkspaceFile: async () => null,
    getAdaptPreset: async () => [
      { label: 'Mock 1:1', width: 1080, height: 1080 },
      { label: 'Mock 9:16', width: 1080, height: 1920 },
    ],
    generateChat: async (messages, images, mode) => {
      await new Promise((r) => setTimeout(r, 500));
      const lastMessage = messages[messages.length - 1]?.content ?? '';
      if (images?.length) {
        return `Mock reply: received ${images.length} attached photo(s) and message: "${lastMessage}"`;
      }
      if (/презентац|presentation|deck|slides/i.test(lastMessage)) {
        return (
          'Done, put together a presentation.\n\n' +
          '```oneflow-document\n' +
          JSON.stringify({
            kind: 'presentation',
            title: 'Mock presentation',
            slides: [
              { title: 'Introduction', bullets: ['First point', 'Second point'], notes: 'Speaker note' },
              { title: 'Data', bullets: ['Figure A', 'Figure B'] },
            ],
          }) +
          '\n```'
        );
      }
      if (/документ|бриф|договор|отчёт|отчет|document|brief|contract|report/i.test(lastMessage)) {
        return (
          'Done, drafted the document.\n\n' +
          '```oneflow-document\n' +
          JSON.stringify({
            kind: 'document',
            title: 'Mock document',
            sections: [
              { heading: 'Section 1', paragraphs: ['A paragraph of text for testing.'] },
              { heading: 'Section 2', bullets: ['List item A', 'List item B'] },
            ],
          }) +
          '\n```'
        );
      }
      if (/вариант|заголовок|идея|option|headline|idea/i.test(lastMessage)) {
        const suggestions =
          mode === 'text'
            ? ['Make it shorter', 'Give more options', 'More sales-driven']
            : ['Add an adapt node', 'Switch to a video model', 'Nothing needed'];
        return (
          `Mock reply (${mode ?? 'assistant'}) to: "${lastMessage}"\n\n` +
          '```oneflow-suggestions\n' +
          JSON.stringify(suggestions) +
          '\n```'
        );
      }
      if (/цепочк|собери|построй|chain|build|assemble/i.test(lastMessage)) {
        return (
          'Adding a chain: text prompt → image generation → video generation.\n\n' +
          '```oneflow-actions\n' +
          JSON.stringify({
            actions: [
              { type: 'addNode', refId: 'n1', nodeType: 'prompt', data: { value: 'Neon city at night' } },
              { type: 'addNode', refId: 'n2', nodeType: 'imageGen', data: { aspectRatio: '16:9' } },
              { type: 'addNode', refId: 'n3', nodeType: 'videoGen' },
              { type: 'connect', from: 'n1', to: 'n2', targetHandle: 'prompt' },
              { type: 'connect', from: 'n2', to: 'n3', targetHandle: 'image' },
            ],
          }) +
          '\n```'
        );
      }
      // Dev-only regression test for the "AI assistant blanks the whole UI" bug: a
      // hostile/malformed action payload (bad model, non-array outputs, unknown fields)
      // should be sanitized away, not crash rendering.
      if (/сломай|break/i.test(lastMessage)) {
        return (
          'Testing the malformed-data guard.\n\n' +
          '```oneflow-actions\n' +
          JSON.stringify({
            actions: [
              {
                type: 'addNode',
                refId: 'bad1',
                nodeType: 'imageGen',
                data: {
                  model: 'not-a-real-model',
                  status: 'done',
                  outputs: 'not-an-array',
                  results: 12345,
                  aspectRatio: 'garbage',
                },
              },
            ],
          }) +
          '\n```'
        );
      }
      return `Mock reply to: "${lastMessage}"`;
    },
    getUsage: async () => {
      const month = new Date().toISOString().slice(0, 7);
      const storedMonth = localStorage.getItem('mock-usage-month');
      const costUsd =
        storedMonth === month ? Number(localStorage.getItem('mock-usage-cost') ?? '0') : 0;
      const limit = Number(localStorage.getItem('mock-usage-limit') ?? '50');
      return { costUsd, limit, month };
    },
    setGenerationLimit: async (limit: number) => {
      localStorage.setItem('mock-usage-limit', String(limit));
      return true;
    },
    listArchive: async () => [],
    openArchiveFolder: async () => true,
    // Dev-preview only: reports the admin's own email so the "Send a message" button
    // (real gating happens in the Edge Function, checked against the caller's JWT) is
    // visible to click through in this mock environment.
    getAuthStatus: async () => ({ configured: true, email: ADMIN_EMAIL }),
    logout: async () => true,
    openDsp: () => {
      window.open(DSP_URL, '_blank', 'noopener,noreferrer');
    },
    getSubscriptionInfo: async () => ({ configured: false, status: null, currentPeriodEnd: null }),
    getGenerationHistory: async () => {
      try {
        return JSON.parse(localStorage.getItem('mock-generation-log') ?? '[]');
      } catch {
        return [];
      }
    },
    sendAdminMessage: async (email, message) => {
      await new Promise((r) => setTimeout(r, 400));
      if (!email.includes('@')) {
        const t = useLanguageStore.getState().language === 'en' ? en : ru;
        return { ok: false, error: t.errors.userNotFound };
      }
      console.log(`[mock] admin message to ${email}: ${message}`);
      return { ok: true };
    },
    getPendingMessages: async () => {
      // Fires once per dev session so the bottom-popup toast is easy to preview, then goes
      // quiet like the real "seen" tracking would.
      if (sessionStorage.getItem('mock-admin-message-shown')) return [];
      sessionStorage.setItem('mock-admin-message-shown', '1');
      const message: AdminMessage = {
        id: 'mock-1',
        body: 'Test message from the admin: this is a demo of the bottom pop-up notification.',
        createdAt: new Date().toISOString(),
      };
      return [message];
    },
    sendHeartbeat: async () => {},
    getOnlineUsers: async () => [
      { email: ADMIN_EMAIL, lastSeen: new Date().toISOString() },
      { email: 'demo.user@example.com', lastSeen: new Date(Date.now() - 90_000).toISOString() },
    ],
    getSubscriptionStatus: async () => ({ active: true, checkoutUrl: '' }),
    // Not metered — the mock/desktop path uses the user's own Replicate key, not the shared
    // owner account the credit system funds.
    getCreditBalance: async () => Number.POSITIVE_INFINITY,
    openCheckout: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    generateAudio: async (params: AudioGenParams): Promise<string> => {
      await new Promise((r) => setTimeout(r, 900));
      const costUsd = params.mode === 'music' ? 0.2 : 0.02;
      bumpMockUsage(costUsd);
      logMockGeneration({
        timestamp: Date.now(),
        model: params.mode === 'music' ? 'minimax/music-2.5' : 'google/gemini-3.1-flash-tts',
        category: 'audio',
        costUsd,
      });
      return makeMockAudioDataUrl();
    },
    connectYandexDisk: async () => true,
    isYandexDiskConnected: () => false,
    disconnectYandexDisk: () => {},
    listYandexAssets: async () => [],
    evaluateCreative: async (images): Promise<CreativeEvaluationResult> => {
      await new Promise((r) => setTimeout(r, 900));
      const variants = images.map((_, i) => ({
        score: 6 + ((i * 2 + 1) % 4),
        strengths: ['Mock: clear focal subject', 'Mock: readable at small size'],
        weaknesses: ['Mock: CTA could stand out more'],
      }));
      return {
        variants,
        verdict: images.length > 1 ? 'Mock: variant 1 reads slightly stronger overall.' : undefined,
        winnerIndex: images.length > 1 ? 0 : undefined,
      };
    },
  };

  window.api = mock;
}
