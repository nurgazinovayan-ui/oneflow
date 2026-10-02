import { useEffect, useState } from 'react';
import { IconCheck, IconClose, IconCopy, IconDownload, IconPlus, IconRocket, IconSparkles } from './Icons';
import { PRODUCT_PALETTES, type ProductPalette } from '../palettes';
import { generatePaletteFromColor } from '../colorUtils';
import { ONELAUNCH_TEMPLATE_SECTIONS, ONELAUNCH_TEMPLATES } from '../onelaunchTemplates';
import type { CreativeVariantEvaluation } from '../types';
import { formatGenerationError } from '../errorMessages';
import { parseSuggestions } from '../chatSuggestions';
import { useT } from '../i18n';

interface OneLaunchPanelProps {
  active: boolean;
}

interface FormatDef {
  key: 'square' | 'story' | 'landscape';
  aspectRatio: string;
}

const FORMATS: FormatDef[] = [
  { key: 'square', aspectRatio: '1:1' },
  { key: 'story', aspectRatio: '9:16' },
  { key: 'landscape', aspectRatio: '3:2' },
];

interface FormatResult {
  key: FormatDef['key'] | 'template';
  label: string;
  image: string;
  evaluation: CreativeVariantEvaluation | null;
}

const IMAGE_MODEL = 'openai/gpt-image-2';
const CUSTOM_PALETTE_KEY = 'custom';

// Static asset (public/onelaunch-templates/...) → data URL, so it can travel to generate-image
// as a reference image the same way the user's own uploaded photo does (pickImageFile already
// returns a data URL, not a path) — Replicate needs either a real absolute URL or a data URI,
// not a root-relative path.
async function assetToDataUrl(path: string): Promise<string> {
  const res = await fetch(path);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// "Уникальный дизайн" — the always-first tile in every section's grid. Unlike a fixed template
// (a pre-made design just gets its text/photo swapped in), this asks the model to invent the
// whole card itself, Wildberries/Ozon marketplace-card style, with the name and advantages
// baked directly into the design by the model rather than drawn on top afterward.
function buildUniqueCardPrompt(name: string, advantages: string[], palette: ProductPalette): string {
  const advantagesBlock = advantages.length
    ? `\n\nДобавь ${advantages.length} значков/плашек с преимуществами товара — оформи их ` +
      `креативно, под общий стиль карточки (необязательно одинаковыми круглыми иконками — ` +
      `можно разного размера, формы, с мини-иллюстрациями), но текст на каждом должен быть ` +
      `написан ТОЧНО так, без единой опечатки и без изменений: ` +
      advantages.map((a, i) => `${i + 1}) "${a}"`).join(', ') +
      '.'
    : '';
  return (
    `Ты — арт-директор рекламного агентства, который делает самые заметные карточки товаров на ` +
    `маркетплейсах (уровня лучших карточек Wildberries/Ozon). Проанализируй товар на ` +
    `прикреплённом референс-фото — определи, что это за товар и к какой категории он относится.\n\n` +
    `Придумай яркую, запоминающуюся рекламную карточку именно под этот товар — НЕ типовой ` +
    `скучный шаблон. Смело используй: нестандартную композицию (диагонали, динамичные ракурсы, ` +
    `наложение слоёв), выразительную типографику (контраст размеров и насыщенности шрифта, ` +
    `акцентные слова), интересный фон (градиенты, текстуры, тематические иллюстрации, свет и ` +
    `тени, глубина), декоративные детали, которые подчёркивают характер и настроение именно ` +
    `этого товара. Карточка должна выделяться и цеплять взгляд с первого кадра ленты, а не ` +
    `выглядеть как случайный конструктор.\n\n` +
    `Портретный формат. Товар с референс-фото — крупным планом, точно такой же, без изменений ` +
    `формы/цвета/дизайна товара.\n\n` +
    `Добавь крупный, хорошо читаемый заголовок с текстом ТОЧНО "${name}" — без опечаток, той же ` +
    `орфографии, на русском языке.${advantagesBlock}\n\n` +
    `Цветовая гамма "${palette.name}" (тона: ${palette.colors.join(', ')}) — отправная точка ` +
    `настроения, а не жёсткое ограничение: можешь добавлять акцентные цвета и вариации оттенков, ` +
    `если это усилит дизайн. Перед завершением перепроверь весь текст на карточке — он должен ` +
    `совпадать с указанным выше без единой ошибки.`
  );
}

function buildPaletteRecommendationPrompt(): string {
  const list = PRODUCT_PALETTES.map((p) => `${p.name} (${p.colors.join(', ')})`).join('; ');
  return (
    `Посмотри на фото товара. Из следующего списка цветовых палитр выбери ОДНУ, которая лучше ` +
    `всего подойдёт для рекламного фото этого товара по контрасту и стилю: ${list}. Ответь ` +
    `строго одним названием палитры из списка, без пояснений и знаков препинания.`
  );
}

function buildCaptionsPrompt(name: string, advantages: string[]): string {
  return (
    `На фото — реальный товар. Посмотри на фото и напиши 3 разных варианта текста для ` +
    `рекламного поста в Instagram для товара "${name}", опираясь на то, что реально изображено ` +
    `на фото, а не только на название. Преимущества товара: ${advantages.join('; ')}. Каждый ` +
    `вариант — короткий, продающий, с эмодзи в меру и парой релевантных хэштегов в конце. ` +
    `Пронумеруй варианты (1., 2., 3.), между ними оставь пустую строку. Только текст постов, ` +
    `без пояснений до или после.`
  );
}

function buildImproveAdvantagesPrompt(name: string, advantagesText: string): string {
  return (
    `Вот преимущества товара "${name}", по одному на строку:\n${advantagesText}\n\nСделай ` +
    `формулировки более продающими, энергичными и конкретными, сохрани ровно то же количество ` +
    `строк и их порядок, не добавляй новые пункты и пояснения. Ответь только исправленным ` +
    `списком, по одному пункту на строку.`
  );
}

// Web-only for now (see App.tsx — gated behind VITE_WEB_MODE). "Product photo → full ad
// campaign" in one pass: orchestrates three already-existing API calls (generateChat for the
// palette pick/caption/advantage copy, generateImage for the per-format photography,
// evaluateCreative for the score) rather than needing a dedicated backend function of its own.
// The product name/advantages are rendered directly on the card by the image model itself
// (GPT Image 2 renders on-image text reliably enough for this) — both the fixed-template path
// and the "unique design" path prompt for exact text and ask the model to double-check spelling
// before finishing. Laid out as a 5-step progressive form (each step disabled until the
// previous one's requirement is met) rather than one flat form, since this is meant to be one
// of the app's flagship flows.
export default function OneLaunchPanel({ active }: OneLaunchPanelProps) {
  const t = useT();
  const [photo, setPhoto] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [advantagesText, setAdvantagesText] = useState('');
  const [improving, setImproving] = useState(false);
  const [selectedFormats, setSelectedFormats] = useState<Record<FormatDef['key'], boolean>>({
    square: true,
    story: true,
    landscape: false,
  });
  const [layoutSection, setLayoutSection] = useState(ONELAUNCH_TEMPLATE_SECTIONS[0]?.key ?? '');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const selectedTemplate = ONELAUNCH_TEMPLATES.find((tpl) => tpl.id === selectedTemplateId) ?? null;
  const [discountText, setDiscountText] = useState('');
  const [selectedPaletteKey, setSelectedPaletteKey] = useState<string | null>(null);
  const [recommendedPaletteKey, setRecommendedPaletteKey] = useState<string | null>(null);
  const [customPalette, setCustomPalette] = useState<ProductPalette | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [results, setResults] = useState<FormatResult[]>([]);
  const [captions, setCaptions] = useState('');

  const palettes = customPalette ? [...PRODUCT_PALETTES, customPalette] : PRODUCT_PALETTES;

  // Progressive gating: each step only unlocks once the previous one's requirement is met, so
  // the form reads as a guided sequence rather than one long page of fields. Step 3 (layout
  // template) is optional — picking one is a finished design with its own fixed aspect ratio
  // and colors, so steps 4 (formats) and 5 (palette) become moot and auto-complete; leaving no
  // template selected keeps the original generic-photo + palette + multi-format flow.
  const step1Done = !!photo;
  const step2Done = step1Done && name.trim().length > 0;
  const step3Done = step2Done;
  const usingTemplate = !!selectedTemplate;
  const anyFormatSelected = FORMATS.some((f) => selectedFormats[f.key]);
  const step4Done = usingTemplate ? step3Done : step3Done && anyFormatSelected;
  const step5Done = usingTemplate ? step4Done : step4Done && !!selectedPaletteKey;

  // As soon as a photo is uploaded, ask the vision model which palette suits it best — shown
  // as a badge on that swatch, and used as the default selection if the user hasn't picked one.
  useEffect(() => {
    if (!photo) {
      setRecommendedPaletteKey(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const reply = await window.api.generateChat(
          [{ role: 'user', content: buildPaletteRecommendationPrompt() }],
          [photo],
          'text'
        );
        if (cancelled) return;
        const match = PRODUCT_PALETTES.find((p) => reply.toLowerCase().includes(p.name.toLowerCase()));
        if (match) {
          setRecommendedPaletteKey(match.key);
          setSelectedPaletteKey((cur) => cur ?? match.key);
        }
      } catch {
        // Best-effort suggestion only — the user can still pick a palette manually.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [photo]);

  const addPhoto = async () => {
    const dataUrl = await window.api.pickImageFile();
    if (dataUrl) setPhoto(dataUrl);
  };

  const toggleFormat = (key: FormatDef['key']) => {
    setSelectedFormats((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const formatLabel = (key: FormatDef['key']): string =>
    key === 'square' ? t.oneLaunch.formatSquare : key === 'story' ? t.oneLaunch.formatStory : t.oneLaunch.formatLandscape;

  const handleImproveAdvantages = async () => {
    if (!advantagesText.trim() || improving) return;
    setImproving(true);
    try {
      const reply = await window.api.generateChat(
        [{ role: 'user', content: buildImproveAdvantagesPrompt(name.trim(), advantagesText) }],
        undefined,
        'text'
      );
      setAdvantagesText(parseSuggestions(reply).cleanedText.trim());
    } catch {
      // Leave the existing text untouched on failure — this is a convenience pass, not
      // required to proceed.
    } finally {
      setImproving(false);
    }
  };

  const handleCustomColor = (hex: string) => {
    const colors = generatePaletteFromColor(hex);
    const palette: ProductPalette = { key: CUSTOM_PALETTE_KEY, name: t.oneLaunch.customPaletteLabel, colors, accent: hex };
    setCustomPalette(palette);
    setSelectedPaletteKey(CUSTOM_PALETTE_KEY);
  };

  const handleLaunch = async () => {
    if (!photo) {
      setStatus('error');
      setError(t.oneLaunch.noPhotoError);
      return;
    }
    if (!name.trim()) {
      setStatus('error');
      setError(t.oneLaunch.noNameError);
      return;
    }
    if (!usingTemplate) {
      const anyFormat = FORMATS.some((f) => selectedFormats[f.key]);
      if (!anyFormat) {
        setStatus('error');
        setError(t.oneLaunch.noFormatError);
        return;
      }
    }
    const advantages = advantagesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    setStatus('running');
    setError('');
    setResults([]);
    setCaptions('');

    try {
      const nextResults: FormatResult[] = [];
      if (selectedTemplate) {
        setStatusMessage(t.oneLaunch.statusGenerating(selectedTemplate.name));
        const templateDataUrl = await assetToDataUrl(selectedTemplate.image);
        const outputs = await window.api.generateImage({
          model: IMAGE_MODEL,
          prompt: selectedTemplate.buildPrompt(name.trim(), advantages, discountText.trim() || undefined),
          aspectRatio: selectedTemplate.aspectRatio,
          resolution: 'high',
          images: [templateDataUrl, photo],
          category: 'image',
        });
        const rawDataUrl = await window.api.fetchImageAsDataUrl(outputs[0]);
        nextResults.push({
          key: 'template',
          label: t.oneLaunch.templateResultLabel,
          image: rawDataUrl,
          evaluation: null,
        });
      } else {
        const formats = FORMATS.filter((f) => selectedFormats[f.key]);
        const palette = palettes.find((p) => p.key === selectedPaletteKey) ?? palettes[0];
        for (const format of formats) {
          setStatusMessage(t.oneLaunch.statusGenerating(formatLabel(format.key)));
          const outputs = await window.api.generateImage({
            model: IMAGE_MODEL,
            prompt: buildUniqueCardPrompt(name.trim(), advantages, palette),
            aspectRatio: format.aspectRatio,
            resolution: 'high',
            image: photo,
            category: 'image',
          });
          const rawDataUrl = await window.api.fetchImageAsDataUrl(outputs[0]);
          nextResults.push({ key: format.key, label: formatLabel(format.key), image: rawDataUrl, evaluation: null });
        }
      }
      setResults(nextResults);

      setStatusMessage(t.oneLaunch.statusEvaluating);
      const evaluated = await Promise.all(
        nextResults.map(async (r) => {
          try {
            const evaluation = await window.api.evaluateCreative([r.image]);
            return { ...r, evaluation: evaluation.variants[0] ?? null };
          } catch {
            return r;
          }
        })
      );
      setResults(evaluated);

      setStatusMessage(t.oneLaunch.statusWritingCaptions);
      // Passing the actual product photo (not just the typed name/advantages) keeps the post
      // copy grounded in what the product really is — without it the model only has a name
      // string to go on and can drift into generic or unrelated copy.
      const captionReply = await window.api.generateChat(
        [{ role: 'user', content: buildCaptionsPrompt(name.trim(), advantages) }],
        [photo],
        'text'
      );
      // The general-purpose "text work" system prompt (see generate-chat's
      // TEXT_CHAT_SYSTEM_PROMPT) may append an oneflow-suggestions fenced block — strip it the
      // same way TextWorkPanel does, since this is a one-shot result, not a chat turn with
      // follow-up chips.
      setCaptions(parseSuggestions(captionReply).cleanedText);

      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(formatGenerationError(err));
    }
  };

  const downloadResult = (r: FormatResult) => {
    void window.api.saveFile(r.image, `${name.trim() || 'product'}-${r.key}.png`);
  };

  const [copiedCaption, setCopiedCaption] = useState<number | null>(null);
  const captionBlocks = captions
    .split(/\n\s*\n/)
    .map((c) => c.trim())
    .filter(Boolean);
  const copyCaption = async (i: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCaption(i);
      setTimeout(() => setCopiedCaption((cur) => (cur === i ? null : cur)), 1200);
    } catch {
      // Clipboard can be blocked (permissions / insecure context) — the text stays selectable.
    }
  };

  // One numbered step label: "① ШАГ N. …" on the left, «готово» / «откроется после шага N» on
  // the right.
  const stepLab = (n: number, title: string, done: boolean, unlocked: boolean) => (
    <div className={`v2-lab v2-step-lab${unlocked ? '' : ' locked'}`}>
      <span>
        <span className={`v2-num${done ? ' done' : ''}`}>{done ? <IconCheck size={10} /> : n}</span>
        {title}
      </span>
      <span className="v2-lab-note">{done ? t.ux.stepDone : unlocked ? '' : t.ux.unlocksAfter(n - 1)}</span>
    </div>
  );

  return (
    <div className={`onelaunch-panel v2-mode v2-split v2-launch ${active ? '' : 'onelaunch-hidden'}`}>
      <section className="v2-card v2-launch-form">
        <div className="v2-scroll">
          {stepLab(1, t.oneLaunch.step1Title, step1Done, true)}
          {photo ? (
            <div className="v2-launch-photo">
              <img src={photo} alt="" />
              <button type="button" className="v2-btn2" onClick={addPhoto}>
                {t.ux.replace}
              </button>
              <button
                type="button"
                className="v2-icon-btn"
                onClick={() => setPhoto(null)}
                title={t.oneLaunch.removePhotoTooltip}
                aria-label={t.oneLaunch.removePhotoTooltip}
              >
                <IconClose size={12} />
              </button>
            </div>
          ) : (
            <button type="button" className="v2-drop" onClick={addPhoto} title={t.oneLaunch.addPhotoTooltip}>
              <b>
                <IconPlus size={14} /> {t.ux.productPhotoCta}
              </b>
              <span>{t.ux.productPhotoHint}</span>
            </button>
          )}

          {stepLab(2, t.oneLaunch.step2Title, step2Done, step1Done)}
          <fieldset className="v2-fieldset" disabled={!step1Done}>
            <input
              className="v2-field"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.oneLaunch.namePlaceholder}
            />
            <div className="v2-row">
              <textarea
                className="v2-field v2-grow"
                rows={3}
                value={advantagesText}
                onChange={(e) => setAdvantagesText(e.target.value)}
                placeholder={t.oneLaunch.advantagesPlaceholder}
              />
              <button
                type="button"
                className="v2-btn2 v2-btn-tall"
                onClick={handleImproveAdvantages}
                disabled={improving || !advantagesText.trim()}
              >
                <IconSparkles size={13} />
                {improving ? t.oneLaunch.improvingBtn : t.oneLaunch.improveBtn}
              </button>
            </div>
          </fieldset>

          {stepLab(3, t.oneLaunch.step3Title, step3Done, step2Done)}
          <fieldset className="v2-fieldset" disabled={!step2Done}>
            <div className="v2-chips">
              {ONELAUNCH_TEMPLATE_SECTIONS.map((section) => (
                <button
                  key={section.key}
                  type="button"
                  className={`v2-chip${layoutSection === section.key ? ' on' : ''}`}
                  onClick={() => setLayoutSection(section.key)}
                >
                  {section.label}
                </button>
              ))}
            </div>
            <div className="v2-launch-templates">
              <button
                type="button"
                className={`v2-launch-tpl v2-launch-tpl-none${!selectedTemplateId ? ' on' : ''}`}
                onClick={() => setSelectedTemplateId(null)}
                title={t.oneLaunch.templateUniqueHint}
              >
                <IconSparkles size={16} />
                {t.oneLaunch.templateNoneLabel}
              </button>
              {ONELAUNCH_TEMPLATES.filter((tpl) => tpl.section === layoutSection).map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className={`v2-launch-tpl${selectedTemplateId === tpl.id ? ' on' : ''}`}
                  onClick={() => setSelectedTemplateId(tpl.id)}
                  title={tpl.name}
                >
                  <img src={tpl.image} alt={tpl.name} loading="lazy" />
                </button>
              ))}
            </div>
            {selectedTemplate?.hasDiscountBadge && (
              <input
                className="v2-field"
                type="text"
                value={discountText}
                onChange={(e) => setDiscountText(e.target.value)}
                placeholder={t.oneLaunch.discountPlaceholder}
              />
            )}
          </fieldset>

          {stepLab(4, t.oneLaunch.step4Title, step4Done, step3Done)}
          {usingTemplate ? (
            <p className="v2-hint">{t.oneLaunch.templateFormatNote}</p>
          ) : (
            <fieldset className="v2-fieldset v2-chips" disabled={!step3Done}>
              {FORMATS.map((f) => (
                <label key={f.key} className={`v2-chip v2-check${selectedFormats[f.key] ? ' on' : ''}`}>
                  <input type="checkbox" checked={selectedFormats[f.key]} onChange={() => toggleFormat(f.key)} />
                  {formatLabel(f.key)}
                </label>
              ))}
            </fieldset>
          )}

          {stepLab(5, t.oneLaunch.step5Title, step5Done, step4Done)}
          {usingTemplate ? (
            <p className="v2-hint">{t.oneLaunch.templatePaletteNote}</p>
          ) : (
            <fieldset className="v2-fieldset" disabled={!step4Done}>
              <div className="v2-palettes">
                {palettes.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={`v2-palette${selectedPaletteKey === p.key ? ' on' : ''}`}
                    onClick={() => setSelectedPaletteKey(p.key)}
                    title={p.name}
                  >
                    <span className="v2-palette-colors">
                      {p.colors.slice(0, 4).map((c, i) => (
                        <span key={i} style={{ background: c }} />
                      ))}
                    </span>
                    <span className="v2-palette-name">{p.name}</span>
                    {recommendedPaletteKey === p.key && <span className="v2-palette-badge">{t.oneLaunch.recommendedBadge}</span>}
                  </button>
                ))}
                <label
                  className={`v2-palette custom${selectedPaletteKey === CUSTOM_PALETTE_KEY ? ' on' : ''}`}
                  title={t.oneLaunch.customPaletteHint}
                >
                  <input
                    type="color"
                    className="onelaunch-color-input"
                    value={customPalette?.accent ?? '#e5157e'}
                    onChange={(e) => handleCustomColor(e.target.value)}
                  />
                  {customPalette ? (
                    <span className="v2-palette-colors">
                      {customPalette.colors.map((c, i) => (
                        <span key={i} style={{ background: c }} />
                      ))}
                    </span>
                  ) : (
                    <span className="v2-palette-colors v2-palette-plus">
                      <IconPlus size={14} />
                    </span>
                  )}
                  <span className="v2-palette-name">{t.oneLaunch.customPaletteLabel}</span>
                </label>
              </div>
            </fieldset>
          )}
        </div>

        <div className="v2-card-foot">
          <button type="button" className="v2-cta" onClick={handleLaunch} disabled={status === 'running' || !step5Done}>
            <IconRocket size={15} />
            {status === 'running' ? t.oneLaunch.launchingBtn : t.oneLaunch.launchBtn}
          </button>
          {!step5Done && status !== 'running' && (
            <p className="v2-hint v2-center">
              {!step1Done ? t.ux.launchNeedPhoto : !step2Done ? t.ux.launchNeedName : t.ux.launchNeedSetup}
            </p>
          )}
          {status === 'error' && <div className="error-text">{error}</div>}
        </div>
      </section>

      <section className="v2-card v2-launch-results">
        {results.length === 0 && status !== 'running' ? (
          <div className="v2-empty">
            <span className="v2-empty-icon">
              <IconRocket size={22} />
            </span>
            <h2>{t.ux.launchEmptyTitle}</h2>
            <p>{t.ux.launchEmptyText}</p>
            <div className="v2-ghosts v2-ghosts-formats" aria-hidden="true">
              <span className="r11">1:1</span>
              <span className="r916">9:16</span>
              <span className="r32">3:2</span>
            </div>
            <div className="v2-ghosts v2-ghosts-posts" aria-hidden="true">
              {[1, 2, 3].map((n) => (
                <span key={n}>{t.ux.postN(n)}</span>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="v2-card-head">
              <b>
                {t.ux.campaignTitle}
                {name.trim() ? ` · ${name.trim()}` : ''}
              </b>
              <span className="v2-pill v2-pill-warn">Beta</span>
            </div>
            {status === 'running' && (
              <div className="v2-progress-note" role="status">
                <span className="v2-spinner" aria-hidden="true" />
                {statusMessage}
              </div>
            )}
            {results.length > 0 && (
              <div className="v2-launch-grid">
                {results.map((r) => (
                  <div key={r.key} className="v2-launch-card">
                    <div className="v2-launch-media">
                      <img src={r.image} alt="" />
                      <span className="v2-tile-tag">{r.label}</span>
                      <button
                        type="button"
                        className="v2-icon-btn v2-launch-dl"
                        onClick={() => downloadResult(r)}
                        title={t.oneLaunch.downloadTooltip}
                        aria-label={t.oneLaunch.downloadTooltip}
                      >
                        <IconDownload size={13} />
                      </button>
                    </div>
                    {r.evaluation && (
                      <div className="v2-launch-eval">
                        <div className="v2-pred-score">
                          <b>{r.evaluation.score}</b>
                          <span>{t.evaluation.scoreOutOf}</span>
                        </div>
                        {r.evaluation.strengths.length > 0 && (
                          <ul className="v2-plus">
                            {r.evaluation.strengths.map((x, i) => (
                              <li key={i}>{x}</li>
                            ))}
                          </ul>
                        )}
                        {r.evaluation.weaknesses.length > 0 && (
                          <ul className="v2-minus">
                            {r.evaluation.weaknesses.map((x, i) => (
                              <li key={i}>{x}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {captionBlocks.length > 0 && (
              <>
                <div className="v2-lab">
                  <span>{t.oneLaunch.captionsTitle}</span>
                </div>
                <div className="v2-captions">
                  {captionBlocks.map((c, i) => (
                    <div key={i} className="v2-caption">
                      <p>{c}</p>
                      <button
                        type="button"
                        className="v2-icon-btn"
                        onClick={() => void copyCaption(i, c)}
                        title={t.aiAssistant.copyTooltip}
                        aria-label={t.aiAssistant.copyTooltip}
                      >
                        {copiedCaption === i ? <IconCheck size={12} /> : <IconCopy size={12} />}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
