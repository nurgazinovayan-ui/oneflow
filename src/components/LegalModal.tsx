import { IconClose } from './Icons';
import { useLanguageStore } from '../i18n';
import { LEGAL_CONTENT, type LegalDoc } from '../legalContent';

interface LegalModalProps {
  doc: LegalDoc;
  onClose: () => void;
}

export default function LegalModal({ doc, onClose }: LegalModalProps) {
  const language = useLanguageStore((s) => s.language);
  const content = LEGAL_CONTENT[language][doc];

  return (
    <div className="modal-overlay legal-modal-overlay" onClick={onClose}>
      <div className="legal-modal" onClick={(e) => e.stopPropagation()}>
        <button className="legal-modal-close" onClick={onClose}>
          <IconClose size={16} />
        </button>
        <div className="legal-modal-scroll">
          <h2 className="legal-modal-title">{content.title}</h2>
          <p className="legal-modal-updated">{content.updated}</p>
          <p className="legal-modal-intro">{content.intro}</p>
          {content.sections.map((section) => (
            <div key={section.heading} className="legal-modal-section">
              <h3>{section.heading}</h3>
              {section.paragraphs.map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
