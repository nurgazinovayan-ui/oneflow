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

// Dev-preview fixture for window.api.marketingAI (Strategy mode v4, see
// supabase/functions/marketing-ai/index.ts for the real server-side provider this mirrors).
// Every field name matches that function's JSON Schemas exactly so UI code built against one
// works unmodified against the other.
function mockMarketingAIResult(task: string): unknown {
  const humanExplanation = `[MOCK] ${task} — тестовые данные для локальной разработки.`;
  switch (task) {
    case 'understandBusiness':
      return {
        product: 'AI-платформа для производства маркетингового контента',
        category: 'Marketing content generation SaaS',
        customerProblem: 'Долго и дорого производить много рекламных материалов вручную',
        value: 'Больше готовых материалов за меньшее время',
        differentiators: ['Генерация из одного фото', 'Много форматов сразу'],
        businessModel: 'Подписка/usage',
        geography: 'Казахстан',
        goal: 'Продажи',
        solvesTodayVia: 'Дизайнер, агентство, несколько AI-сервисов',
        mainPurchaseRisk: 'AI исказит товар или сделает плохой дизайн',
        ambiguities: [],
        evidenceIds: [],
        missingData: ['Данные рекламных кабинетов'],
        humanExplanation,
      };
    case 'analyzeSegments':
      return {
        segments: [
          {
            name: 'Marketplace sellers',
            buyingSituation: 'Нужно быстро выпускать много SKU',
            needFrequency: 'Часто',
            abilityToPay: 'Средняя',
            accessibility: 'Высокая',
            urgencyTrigger: 'Запуск нового сезона/товара',
            productFit: 'Высокий',
            priority: 'now',
            priorityRationale: 'Частая задача, легко демонстрируется визуально',
            evidenceIds: [],
            confidence: 'medium',
            assumptions: ['Оценка по структуре бизнеса'],
          },
        ],
        missingData: [],
        humanExplanation,
      };
    case 'analyzeJTBD':
      return {
        jtbd: [
          {
            segmentId: 'seg-1',
            situation: 'Нужно быстро запустить рекламу под новый товар',
            motivation: 'Получить готовые материалы без дизайнера',
            desiredOutcome: 'Быстрее вывести товар в продажу',
            alternativesToday: 'Дизайнер, агентство',
            anxieties: 'AI изменит сам товар',
            evidenceIds: [],
          },
        ],
        humanExplanation,
      };
    case 'proposePositioning':
      return {
        directions: [
          {
            segmentId: 'seg-1',
            alternative: 'Дизайнер/агентство',
            value: 'Реклама из одного фото за минуты',
            reasonToBelieve: 'Автоматическая генерация из фото товара',
            proofNeeded: 'Пример до/после',
            style: 'outcome',
            evidenceIds: [],
            recommended: true,
          },
        ],
        humanExplanation,
      };
    case 'proposeOffers':
      return {
        offers: [
          {
            segmentId: 'seg-1',
            motive: 'speed',
            promise: 'Вся реклама товара из одного фото',
            mechanism: 'AI-генерация карточек и креативов',
            proof: 'Демо-workflow',
            objectionHandled: 'AI исказит товар',
            cta: 'Попробовать бесплатно',
            evidenceType: 'hypothesis',
            confidence: 'medium',
            experimentNeeded: true,
            recommended: true,
          },
        ],
        humanExplanation,
      };
    case 'analyzeChannels':
      return {
        channels: [
          {
            channel: 'TikTok',
            role: 'Создавать спрос через визуальную демонстрацию',
            targetSegmentId: 'seg-1',
            funnelStage: 'awareness',
            contentTypes: ['Before/After', 'Demo'],
            whyTest: 'Высокая доля целевой аудитории, дешёвый тест',
            requiredData: ['Рекламный кабинет TikTok'],
            scaleCriteria: ['Устойчивый CAC ниже цели 2 недели подряд'],
            pauseCriteria: ['CAC выше цели без признаков улучшения'],
            evidenceIds: [],
            confidence: 'low',
          },
        ],
        humanExplanation,
      };
    case 'proposeCreativeStrategy':
      return {
        concepts: [
          {
            archetype: 'before_after',
            hook: 'Одно фото → готовая реклама за секунды',
            visualFormat: 'demo',
            messagingTheme: 'benefit-led',
            offerId: 'offer-1',
            cta: 'Попробовать бесплатно',
            persona: 'not_observable',
            intentStage: 'prospecting',
            variantsToTest: ['Разный hook', 'Разный товар'],
            evidenceIds: [],
          },
        ],
        humanExplanation,
      };
    case 'designExperiments':
      return {
        experiments: [
          {
            hypothesisId: 'hyp-1',
            name: 'Offer A vs Offer B',
            variable: 'Offer message',
            control: 'Offer A',
            variants: ['Offer B'],
            audienceId: 'seg-1',
            primaryMetric: 'Qualified signup rate',
            guardrailMetrics: ['Activation rate'],
            minDataRule: 'Минимум 200 конверсий на вариант',
            durationRule: 'Не менее 7 дней',
            decisionRule: 'Статистически значимый лифт и не хуже guardrail',
          },
        ],
        humanExplanation,
      };
    case 'interpretResults':
      return {
        whatHappened: 'Вариант B дал более высокий qualified signup rate',
        likelyDrivers: ['Более конкретный оффер'],
        unsupportedExplanations: ['Сезонность (не подтверждено)'],
        evidenceIds: [],
        confidence: 'medium',
        strength: 'moderate',
        affectedStrategyPaths: ['offers'],
        strategyUpdateProposal: {
          changes: [{ field: 'primaryOffer', before: 'Offer A', after: 'Offer B' }],
          why: 'Offer B показал статистически значимый лифт без ухудшения guardrail',
          evidenceIds: [],
          affectedModules: ['offers', 'creative'],
          requiresUserApproval: true,
          rollbackLabel: 'Вернуть Offer A как основной',
        },
        humanExplanation,
      };
    case 'explainRecommendation':
      return {
        whatWeSaw: 'Вариант B дал более высокий qualified signup rate',
        whyItMatters: 'Это основной оффер, который увидит большинство новой аудитории',
        howConfirmed: 'Один завершённый эксперимент, статистически значимый лифт',
        whatToCheckNext: 'Повторить тест на другом сегменте',
        whatChangesOnApply: 'Offer B станет основным оффером в плане и креативах',
      };
    default:
      return { humanExplanation };
  }
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
    marketingAI: async (task, _context, _mock) => {
      await new Promise((r) => setTimeout(r, 400));
      return { result: mockMarketingAIResult(task), schemaVersion: '4.0.0', promptVersion: '4.0.0', mock: true };
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
    // Demo mode has no real logged-in identity — never report the admin's own email here, or
    // the admin panel (gated on authEmail === ADMIN_EMAIL in App.tsx) would incorrectly show up
    // for every visitor who clicks "Demo mode". isDemo:true is the signal the toolbar's "Тариф"
    // button uses to still show itself despite getSubscriptionStatus below always reporting an
    // active subscription (there's no real subscription concept in this mock environment).
    getAuthStatus: async () => ({ configured: true, email: null, isDemo: true }),
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
    sendAdminMessage: async (target, message) => {
      await new Promise((r) => setTimeout(r, 400));
      if (target.mode === 'selected' && target.emails.some((e) => !e.includes('@'))) {
        const t = useLanguageStore.getState().language === 'en' ? en : ru;
        return { ok: false, error: t.errors.userNotFound };
      }
      const count = target.mode === 'all' ? 2 : target.emails.length;
      console.log(`[mock] admin message (${target.mode}): ${message}`);
      return { ok: true, count };
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
    getMechtaGenerations: async () => [
      {
        email: 'demo.user@mechta.kz',
        model: 'google/nano-banana-pro',
        category: 'image',
        costUsd: 0.134,
        createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      },
      {
        email: 'demo.user@mechta.kz',
        model: 'bytedance/seedance-2.5',
        category: 'video',
        costUsd: 1.2,
        createdAt: new Date(Date.now() - 7_200_000).toISOString(),
      },
    ],
    getSubscriptionStatus: async () => ({ active: true, checkoutUrl: '' }),
    // Not metered — the mock/desktop path uses the user's own Replicate key, not the shared
    // owner account the credit system funds.
    getCreditBalance: async () => Number.POSITIVE_INFINITY,
    getCheckoutUrl: async () => '',
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
    loadYandexAsset: async (path: string) => path,
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
