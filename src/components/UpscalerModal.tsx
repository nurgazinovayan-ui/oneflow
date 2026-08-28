import { useState } from 'react';
import NodeStyleModal from './NodeStyleModal';
import { IconClose, IconDownload, IconPlus, IconTool } from './Icons';
import { formatGenerationError } from '../errorMessages';
import { useT } from '../i18n';

interface UpscalerModalProps {
  onClose: () => void;
}

const MODEL = 'nightmareai/real-esrgan';

export default function UpscalerModal({ onClose }: UpscalerModalProps) {
  const t = useT();
  const [image, setImage] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');

  const addImage = async () => {
    const dataUrl = await window.api.pickImageFile();
    if (dataUrl) {
      setImage(dataUrl);
      setResult(null);
    }
  };

  const handleRun = async () => {
    if (!image) {
      setStatus('error');
      setError(t.tools.noImageError);
      return;
    }
    setStatus('loading');
    setError('');
    try {
      const outputs = await window.api.generateImage({
        model: MODEL,
        prompt: '',
        aspectRatio: '1:1',
        image,
        category: 'image',
      });
      const dataUrl = await window.api.fetchImageAsDataUrl(outputs[0]);
      setResult(dataUrl);
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(formatGenerationError(err));
    }
  };

  const download = () => {
    if (result) void window.api.saveFile(result, 'upscaled.png');
  };

  return (
    <NodeStyleModal title={t.tools.upscalerTitle} icon={<IconTool size={14} />} onClose={onClose}>
      <div className="tool-modal-body">
        {image ? (
          <div className="evaluation-slot filled tool-modal-slot">
            <img src={image} alt="" />
            <button
              className="evaluation-slot-remove"
              onClick={() => {
                setImage(null);
                setResult(null);
              }}
              title={t.tools.removeImageTooltip}
            >
              <IconClose size={12} />
            </button>
          </div>
        ) : (
          <button
            className="evaluation-slot empty tool-modal-slot"
            onClick={addImage}
            title={t.tools.addImageTooltip}
          >
            <IconPlus size={20} />
          </button>
        )}

        {/* real-esrgan's scale is fixed to 2x server-side for now (see buildImageInput in
            electron/main.ts and supabase/functions/generate-image) — shown here as a label
            rather than a live control since there's nothing to pick yet. */}
        <div className="tool-modal-scale-hint">{t.tools.scaleLabel}: 2x</div>

        <button className="generate-btn tool-modal-run-btn" onClick={handleRun} disabled={status === 'loading' || !image}>
          <IconTool size={14} />
          {status === 'loading' ? t.tools.upscalingBtn : t.tools.upscaleBtn}
        </button>

        {status === 'error' && <div className="error-text">{error}</div>}

        {result && (
          <div className="tool-modal-result">
            <img src={result} alt="" className="tool-modal-result-img" />
            <button className="secondary-btn tool-modal-download-btn" onClick={download}>
              <IconDownload size={13} /> {t.tools.downloadBtn}
            </button>
          </div>
        )}
      </div>
    </NodeStyleModal>
  );
}
