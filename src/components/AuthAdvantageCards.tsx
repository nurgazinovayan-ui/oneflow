import { useEffect, useState } from 'react';
import { useT } from '../i18n';

// Auto-advancing carousel of product-advantage cards shown on the login/register screen's
// media panel (see WebAuthGate.tsx) — content comes from t.webAuth.advantages so it stays
// bilingual like the rest of the app. Slower than a typical onboarding-tour pace since this
// runs continuously in the background of a form the visitor is actively filling in.
const AUTO_ADVANCE_MS = 6000;

export default function AuthAdvantageCards() {
  const t = useT();
  const items = t.webAuth.advantages;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (items.length <= 1) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % items.length), AUTO_ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [items.length]);

  const current = items[index];
  if (!current) return null;

  return (
    <div className="web-auth-advantages">
      <div className="web-auth-advantage-image-wrap">
        <img
          key={current.image}
          src={`/auth-advantages/${current.image}`}
          alt={current.imageAlt}
          className="web-auth-advantage-image"
        />
      </div>
      <div className="web-auth-advantage-body">
        <h3 key={`title-${index}`} className="web-auth-advantage-title">
          {current.title}
        </h3>
        <p key={`desc-${index}`} className="web-auth-advantage-description">
          {current.description}
        </p>
        <p key={`benefit-${index}`} className="web-auth-advantage-benefit">
          {current.benefit}
        </p>
      </div>
      <div className="web-auth-advantage-dots">
        {items.map((item, i) => (
          <button
            key={item.image}
            type="button"
            className={`web-auth-advantage-dot${i === index ? ' active' : ''}`}
            aria-label={item.title}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </div>
  );
}
