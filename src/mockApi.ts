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
      // Strategy mode's onboarding call (see strategyPrompts.ts) sends a recognizable marker —
      // checked before the generic images?.length branch below, since a strategy brief can
      // include an optional product photo too.
      if (/AI Marketing Strategist/i.test(lastMessage)) {
        return JSON.stringify({
          title: 'Q4 Growth Strategy',
          goalSummary: 'Увеличить платные конверсии на 25% за 3 месяца.',
          positioning: {
            primaryStatement: 'AI-рабочее пространство, которое превращает одно фото товара в готовую маркетинговую кампанию.',
            valueProposition: 'Полноценная кампания без найма дизайнера и агентства.',
            reasonsToBelieve: ['Генерация карточек за минуты, а не дни', 'Один инструмент вместо пяти подрядчиков'],
            differentiators: ['AI-скоринг креативов встроен в продукт', 'Работает из одного фото товара'],
            tone: 'уверенный, экспертный',
            alternatives: [
              { label: 'Рациональный', statement: 'Экономит бюджет на дизайне и подрядчиках — считаемая выгода в деньгах.' },
              { label: 'Эмоциональный', statement: 'Больше не нужно ждать дизайнера — идея становится кампанией за минуты.' },
            ],
            confidence: 78,
          },
          offers: [
            {
              text: 'Создать полноценную кампанию из одного фото товара за 5 минут.',
              angle: 'Скорость',
              targetSegmentName: 'Marketplace Sellers',
              funnelStage: 'conversion',
              score: 88,
              isPrimary: true,
            },
            {
              text: 'Первая карточка товара — бесплатно, без привязки карты.',
              angle: 'Снижение риска',
              targetSegmentName: 'Small Businesses',
              funnelStage: 'consideration',
              score: 74,
              isPrimary: false,
            },
          ],
          scoreBreakdown: { audience: 92, positioning: 86, offer: 88, channels: 74, content: 79, funnel: 81, retention: 63, measurement: 70 },
          audience: [
            {
              name: 'Marketplace Sellers',
              potential: 'High',
              description: 'Быстро создают карточки товаров для большого количества SKU.',
              mainJob: 'Выпустить много карточек товаров без роста издержек на дизайн.',
              painPoints: ['Высокая стоимость продакшена', 'Медленный процесс согласований'],
              purchaseTriggers: ['Запуск нового сезона SKU', 'Рост конкуренции на маркетплейсе'],
              objections: ['Не уверены в качестве AI-дизайна'],
              recommendedMessage: 'Из одного фото — готовая карточка за 5 минут.',
              confidence: 82,
            },
            {
              name: 'Small Businesses',
              potential: 'Medium',
              description: 'Нужен маркетинг без найма отдельной команды.',
              mainJob: 'Запускать рекламу самостоятельно, без агентства.',
              painPoints: ['Ограниченный бюджет', 'Нет времени на дизайн'],
              purchaseTriggers: ['Сезонная распродажа', 'Запуск нового продукта'],
              objections: ['Не хватает бюджета на подписку'],
              recommendedMessage: 'Полноценная кампания без найма дизайнера.',
              confidence: 68,
            },
          ],
          competitors: [],
          channels: [
            { name: 'TikTok', percent: 35, rationale: 'Основная аудитория продавцов маркетплейсов активна в TikTok.', confidence: 74, cpcRange: { min: 60, max: 120 } },
            { name: 'Instagram', percent: 30, rationale: 'Высокая вовлечённость в визуальный контент карточек товаров.', confidence: 78, cpcRange: { min: 90, max: 160 } },
            { name: 'Google Ads', percent: 18, rationale: 'Захват прямого поискового спроса на инструмент.', confidence: 65 },
            { name: 'Influencers', percent: 12, rationale: 'Доверие через нишевых блогеров-продавцов.', confidence: 55 },
            { name: 'Email', percent: 5, rationale: 'Удержание и повторные покупки существующей базы.', confidence: 60 },
          ],
          contentMatrix: [
            { format: 'UGC', stages: ['awareness', 'consideration', 'conversion'], audienceName: 'Marketplace Sellers', objective: 'Показать реальный результат использования', hook: 'Одно фото → готовая карточка за 5 минут', message: 'Реальные продавцы показывают процесс', cta: 'Попробовать бесплатно', recommendedAssets: ['video', 'copy'], priority: 'high' },
            { format: 'Product Demo', stages: ['awareness', 'consideration', 'conversion'], audienceName: 'Marketplace Sellers', objective: 'Снять сомнение в качестве результата', hook: 'Покажите исходное фото в первые 2 секунды', message: 'Одна фотография → готовая карточка', cta: 'Try Free', recommendedAssets: ['video', 'image'], priority: 'high' },
            { format: 'Education', stages: ['awareness', 'consideration'], audienceName: 'Small Businesses', objective: 'Объяснить, как работает AI-генерация', hook: 'Как AI создаёт карточку из одного фото', message: 'Пошаговый разбор процесса', cta: 'Узнать больше', recommendedAssets: ['video'], priority: 'medium' },
            { format: 'Comparison', stages: ['consideration', 'conversion'], audienceName: 'Small Businesses', objective: 'Показать выгоду против найма дизайнера', hook: 'Дизайнер vs ONEFLOW: 3 дня против 5 минут', message: 'Сравнение цены и скорости', cta: 'Сравнить', recommendedAssets: ['image', 'copy'], priority: 'medium' },
            { format: 'Testimonials', stages: ['consideration', 'conversion'], audienceName: 'Marketplace Sellers', objective: 'Снять последние сомнения перед покупкой', hook: 'Отзыв продавца с ростом конверсии', message: 'Реальные цифры роста продаж', cta: 'Начать', recommendedAssets: ['video', 'copy'], priority: 'medium' },
          ],
          funnel: [
            { label: 'Impressions', volume: 1_000_000, conversionToNext: 2.8 },
            { label: 'Clicks', volume: 28_000, conversionToNext: 12 },
            { label: 'Sign Ups', volume: 3_360, conversionToNext: 7 },
            { label: 'Purchases', volume: 235 },
          ],
          journey: [
            { stage: 'discover', customerThought: 'Мне надоело тратить часы на карточки товаров.', message: 'Один инструмент — вся кампания', channel: 'TikTok', content: 'UGC-видео', cta: 'Узнать больше' },
            { stage: 'interest', customerThought: 'Похоже, это быстрее, чем нанимать дизайнера.', message: 'Из фото — в кампанию за 5 минут', channel: 'Instagram', content: 'Product Demo', cta: 'Смотреть демо' },
            { stage: 'research', customerThought: 'А результат правда такой же качественный?', message: 'Сравнение с дизайнером', channel: 'Google Ads', content: 'Comparison', cta: 'Сравнить' },
            { stage: 'try', customerThought: 'Попробую на одном товаре.', message: 'Первая карточка бесплатно', channel: 'Email', content: 'Onboarding', cta: 'Попробовать' },
            { stage: 'buy', customerThought: 'Это экономит мне время и деньги.', message: 'Полноценная кампания за 5 минут', channel: 'Продукт', content: 'Оффер', cta: 'Оформить' },
            { stage: 'return', customerThought: 'Хочу так же для новых товаров.', message: 'Новые SKU — новые карточки', channel: 'Email', content: 'Retention-рассылка', cta: 'Создать ещё' },
          ],
          kpis: [
            { label: 'Платные конверсии', target: '+25%', unit: 'за 3 мес.' },
            { label: 'CAC', target: '≤ 3 500', unit: '₸' },
            { label: 'Активные сегменты', target: '2', unit: 'шт.' },
          ],
          risks: [
            { title: 'Low retention', description: 'Повторные продажи почти не используются в текущей стратегии.', evidence: 'В плане нет задач на удержание после первой покупки.', affectedEntities: ['Retention', 'KPI'] },
            { title: 'High CAC on paid search', description: 'Google Ads может оказаться дороже прогноза на этом рынке.', evidence: 'CPC-диапазон для Google Ads на этом рынке шире, чем у TikTok/Instagram.', affectedEntities: ['Channels', 'Budget'] },
          ],
          opportunities: [
            { title: 'TikTok potential', description: 'TikTok уже получает наибольшую долю бюджета и показывает лучший потенциальный охват для этого сегмента.', evidence: 'Основной сегмент Marketplace Sellers активнее всего в TikTok.', affectedEntities: ['Channels'] },
          ],
          plan: [
            { day: 'MON 03', title: 'Create 3 UGC creatives', tag: 'Conversion · Marketplace Sellers', type: 'generate' },
            { day: 'TUE 04', title: 'Create Product Demo campaign', tag: 'Awareness · Marketplace Sellers', type: 'generate' },
            { day: 'WED 05', title: 'Compare 3 offers', tag: 'Conversion · Small Businesses', type: 'compare' },
            { day: 'THU 06', title: 'Score last week creatives', tag: 'Content · All segments', type: 'score' },
            { day: 'FRI 07', title: 'Launch campaign in ad account', tag: 'Manual · Marketing team', type: 'manual' },
            { day: 'SAT 08', title: 'Review weekly results', tag: 'Retention · All segments', type: 'review' },
          ],
          topInsight: {
            title: 'TikTok уже получает наибольшую долю бюджета',
            description: 'Instagram показывает более высокий CPC на этом рынке — перераспределить ещё 10% с Instagram на TikTok?',
          },
          assumptions: [
            { field: 'CPC Google Ads', value: 'диапазон не указан', confidenceLabel: 'гипотеза AI' },
          ],
        });
      }
      // Offer Engine "Generate alternatives" (see strategyPrompts.ts buildOfferAlternativesPrompt).
      if (/Предложи 3 новых оффера/i.test(lastMessage)) {
        return JSON.stringify({
          offers: [
            { text: 'Подписка на 3 месяца — цена как за одну карточку у фрилансера.', angle: 'Ценность за деньги', targetSegmentName: 'Small Businesses', funnelStage: 'consideration', score: 71 },
            { text: 'Загрузите каталог — получите готовые карточки для всех SKU за ночь.', angle: 'Масштаб', targetSegmentName: 'Marketplace Sellers', funnelStage: 'conversion', score: 79 },
            { text: 'AI-скоринг покажет, какая карточка продаст лучше, ещё до запуска.', angle: 'Снижение риска', targetSegmentName: 'Marketplace Sellers', funnelStage: 'awareness', score: 68 },
          ],
        });
      }
      // Strategy Assistant calls (see strategyPrompts.ts buildAssistantActionSystemPrompt) — a
      // change-intent question ("перераспредели бюджет...") gets a structured action JSON back,
      // matching the real contract; anything else gets a plain-text answer.
      if (/Доступные id для действий/i.test(lastMessage)) {
        if (/бюджет|раздели|перераспредел/i.test(lastMessage)) {
          const channelLine = /каналы: ([^\n]+)/.exec(lastMessage)?.[1] ?? '';
          const ids: Record<string, string> = {};
          for (const m of channelLine.matchAll(/([\w-]+) \(([^)]+)\)/g)) ids[m[2]] = m[1];
          const tiktok = ids['TikTok'];
          const instagram = ids['Instagram'];
          if (tiktok && instagram) {
            return JSON.stringify({
              type: 'reallocate_budget',
              rationale: 'TikTok показывает более высокий потенциальный охват для основного сегмента при более низком CPC, чем Instagram.',
              channelChanges: [
                { channelId: tiktok, allocation: 45 },
                { channelId: instagram, allocation: 20 },
              ],
            });
          }
        }
        return 'Сейчас основной сегмент — Marketplace Sellers, он получает наибольший потенциал по охвату. Рекомендую в первую очередь протестировать Product Demo в TikTok — это самый сильный формат по текущим предположениям.';
      }
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
