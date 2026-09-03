import { useState } from 'react';
import { IconRocket } from './Icons';
import type { StrategyData } from '../strategyTypes';
import { buildStrategyWorkflowPrompt } from '../strategyPrompts';
import { useT } from '../i18n';

interface CreateFromStrategyModalProps {
  data: StrategyData;
  initialAudienceName?: string;
  onClose: () => void;
  onCreate: (prompt: string) => void;
}

// Spec section 52 — a small modal with the strategy context already filled in, ending in
// "ONEFLOW will create: ...". Scoped down to what the app can actually deliver today (one
// Prompt→Image-input→Image-gen chain dropped into the Nodes canvas, same shape as the "Для
// бизнеса" tiles) rather than the full Script/Image/Video/Copy/Score bundle the mockup shows —
// those other outputs don't have a matching orchestration yet.
export default function CreateFromStrategyModal({
  data,
  initialAudienceName,
  onClose,
  onCreate,
}: CreateFromStrategyModalProps) {
  const t = useT();
  const [audienceName, setAudienceName] = useState(initialAudienceName ?? data.audience[0]?.name ?? '');
  const formats = Array.from(new Set(data.contentMatrix.map((r) => r.format)));
  const [format, setFormat] = useState(formats[0] ?? 'Product Demo');

  const handleCreate = () => {
    onCreate(buildStrategyWorkflowPrompt(data, audienceName, format));
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal strategy-create-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.strategy.createModalTitle}</h2>
        <label className="strategy-field-label">
          {t.strategy.audienceCardTitle}
          <select className="node-select" value={audienceName} onChange={(e) => setAudienceName(e.target.value)}>
            {data.audience.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="strategy-field-label">
          {t.strategy.createModalFormat}
          <select className="node-select" value={format} onChange={(e) => setFormat(e.target.value)}>
            {formats.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <div className="strategy-create-modal-offer">
          <div className="strategy-drawer-field-label">{t.strategy.offerCardTitle}</div>
          <div className="strategy-drawer-field-value">{data.offer}</div>
        </div>
        <div className="strategy-create-modal-hint">{t.strategy.createModalHint}</div>
        <div className="modal-actions">
          <button type="button" className="secondary-btn" onClick={onClose}>
            {t.strategy.onboardBack}
          </button>
          <button type="button" className="generate-btn" onClick={handleCreate}>
            <IconRocket size={13} /> {t.strategy.createModalBtn}
          </button>
        </div>
      </div>
    </div>
  );
}
