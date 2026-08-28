import { useEffect, useRef, useState } from 'react';
import NodeStyleModal from './NodeStyleModal';
import { IconDownload, IconPlus, IconRefresh, IconTool } from './Icons';
import { useT } from '../i18n';

interface PhotoEditorModalProps {
  onClose: () => void;
}

type CropPreset = 'original' | 'square';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

// Basic client-side photo editor behind Инструменты → Фоторедактор: rotate (90° steps), flip,
// brightness/contrast, and a couple of crop presets. Every control redraws the canvas fresh
// from the originally loaded image (non-destructive) rather than mutating pixels in place, so
// nothing compounds or degrades as the user adjusts sliders back and forth.
export default function PhotoEditorModal({ onClose }: PhotoEditorModalProps) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [cropPreset, setCropPreset] = useState<CropPreset>('original');

  const addImage = async () => {
    const dataUrl = await window.api.pickImageFile();
    if (!dataUrl) return;
    const img = await loadImage(dataUrl);
    setImage(img);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setBrightness(0);
    setContrast(0);
    setCropPreset('original');
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let sx = 0;
    let sy = 0;
    let sw = image.naturalWidth;
    let sh = image.naturalHeight;
    if (cropPreset === 'square') {
      const side = Math.min(sw, sh);
      sx = (sw - side) / 2;
      sy = (sh - side) / 2;
      sw = side;
      sh = side;
    }

    const swapped = rotation === 90 || rotation === 270;
    canvas.width = swapped ? sh : sw;
    canvas.height = swapped ? sw : sh;

    ctx.save();
    ctx.filter = `brightness(${100 + brightness}%) contrast(${100 + contrast}%)`;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    ctx.drawImage(image, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
  }, [image, rotation, flipH, flipV, brightness, contrast, cropPreset]);

  const reset = () => {
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setBrightness(0);
    setContrast(0);
    setCropPreset('original');
  };

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void window.api.saveFile(canvas.toDataURL('image/png'), 'edited-photo.png');
  };

  return (
    <NodeStyleModal title={t.tools.photoEditorTitle} icon={<IconTool size={14} />} onClose={onClose} width={560}>
      <div className="tool-modal-body">
        {!image ? (
          <button
            className="evaluation-slot empty tool-modal-slot tool-modal-slot-lg"
            onClick={addImage}
            title={t.tools.addImageTooltip}
          >
            <IconPlus size={22} />
          </button>
        ) : (
          <>
            <div className="photo-editor-canvas-wrap">
              <canvas ref={canvasRef} className="photo-editor-canvas" />
            </div>

            <div className="photo-editor-controls">
              <div className="photo-editor-row">
                <button className="secondary-btn photo-editor-btn" onClick={() => setRotation((r) => (r + 270) % 360)} title={t.tools.rotateLeftTooltip}>
                  <span className="photo-editor-mirrored-icon">
                    <IconRefresh size={13} />
                  </span>
                </button>
                <button className="secondary-btn photo-editor-btn" onClick={() => setRotation((r) => (r + 90) % 360)} title={t.tools.rotateRightTooltip}>
                  <IconRefresh size={13} />
                </button>
                <button
                  className={`secondary-btn photo-editor-btn ${flipH ? 'active' : ''}`}
                  onClick={() => setFlipH((v) => !v)}
                  title={t.tools.flipHTooltip}
                >
                  ⇋
                </button>
                <button
                  className={`secondary-btn photo-editor-btn ${flipV ? 'active' : ''}`}
                  onClick={() => setFlipV((v) => !v)}
                  title={t.tools.flipVTooltip}
                >
                  ⇵
                </button>
                <button className="secondary-btn photo-editor-btn" onClick={reset} title={t.tools.resetBtn}>
                  {t.tools.resetBtn}
                </button>
              </div>

              <div className="photo-editor-slider-row">
                <span className="field-label">{t.tools.brightnessLabel}</span>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={brightness}
                  onChange={(e) => setBrightness(Number(e.target.value))}
                />
              </div>
              <div className="photo-editor-slider-row">
                <span className="field-label">{t.tools.contrastLabel}</span>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={contrast}
                  onChange={(e) => setContrast(Number(e.target.value))}
                />
              </div>

              <div className="photo-editor-row">
                <span className="field-label">{t.tools.cropLabel}</span>
                <button
                  className={`secondary-btn photo-editor-crop-btn ${cropPreset === 'original' ? 'active' : ''}`}
                  onClick={() => setCropPreset('original')}
                >
                  {t.tools.cropOriginal}
                </button>
                <button
                  className={`secondary-btn photo-editor-crop-btn ${cropPreset === 'square' ? 'active' : ''}`}
                  onClick={() => setCropPreset('square')}
                >
                  {t.tools.cropSquare}
                </button>
              </div>

              <button className="generate-btn tool-modal-run-btn" onClick={download}>
                <IconDownload size={14} /> {t.tools.downloadBtn}
              </button>
            </div>
          </>
        )}
      </div>
    </NodeStyleModal>
  );
}
