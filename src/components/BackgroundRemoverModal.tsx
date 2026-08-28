import { useState } from 'react';
import NodeStyleModal from './NodeStyleModal';
import { IconClose, IconDownload, IconPlus, IconTool } from './Icons';
import { formatGenerationError } from '../errorMessages';
import { useT } from '../i18n';

interface BackgroundRemoverModalProps {
  onClose: () => void;
}

const MODEL = '851-labs/background-remover';

export default function BackgroundRemoverModal({ onClose }: BackgroundRemoverModalProps) {
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
    if (result) void window.api.saveFile(result, 'background-removed.png');
  };

  return (
    <NodeStyleModal title={t.tools.bgRemoverTitle} icon={<IconTool size={14} />} onClose={onClose}>
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

        <button className="generate-btn tool-modal-run-btn" onClick={handleRun} disabled={status === 'loading' || !image}>
          <IconTool size={14} />
          {status === 'loading' ? t.tools.removingBgBtn : t.tools.removeBgBtn}
        </button>

        {status === 'error' && <div className="error-text">{error}</div>}

        {result && (
          <div className="tool-modal-result">
            <div className="tool-modal-result-checker">
              <img src={result} alt="" />
            </div>
            <button className="secondary-btn tool-modal-download-btn" onClick={download}>
              <IconDownload size={13} /> {t.tools.downloadBtn}
            </button>
          </div>
        )}
      </div>
    </NodeStyleModal>
  );
}
