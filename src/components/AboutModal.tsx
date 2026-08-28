import { useT } from '../i18n';

interface AboutModalProps {
  onClose: () => void;
}

export default function AboutModal({ onClose }: AboutModalProps) {
  const t = useT();
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal about-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.aboutModal.title}</h2>
        <p className="about-text">{t.aboutModal.text}</p>
        <div className="modal-actions">
          <button className="generate-btn" onClick={onClose}>
            {t.aboutModal.close}
          </button>
        </div>
      </div>
    </div>
  );
}
