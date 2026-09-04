import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { setWebSession, type WebSession } from '../webAuthSession';
import { installMockApiIfNeeded } from '../mockApi';
import { useT } from '../i18n';
import DomeGallery from './DomeGallery';
import WebAuthHeader from './WebAuthHeader';
import LegalModal from './LegalModal';
import type { LegalDoc } from '../legalContent';
import { IconEye, IconEyeOff } from './Icons';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface WebAuthGateProps {
  children: ReactNode;
}

type Stage = 'login' | 'unlocked';
type PanelMode = 'login' | 'register';

// Gates the whole app behind Supabase login on the web build. Login is required on every page
// load by design — nothing is persisted to localStorage — matching the desktop app's "check
// login every launch" behavior. An unpaid LemonSqueezy subscription no longer blocks entry
// here — that's a soft in-app gate now (top-bar "Оплатить тариф" button + payment modal on
// Generate, see src/store/subscriptionContext.ts and PaymentModal), driven by
// window.api.getSubscriptionStatus() once the user is already inside.
//
// Visually ported from a shadcn/Tailwind "sign-in" reference component — full-viewport split
// screen (form left, media right), sized exactly as that component's own h-[100dvh] w-[100dvw]
// classes specify, not the compact floating-window look this used before. See App.css's
// .web-auth-gate block for the token-based (no Tailwind) port of its typography/spacing scale.
export default function WebAuthGate({ children }: WebAuthGateProps) {
  const t = useT();
  const [stage, setStage] = useState<Stage>('login');
  const [mode, setMode] = useState<PanelMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerPasswordConfirm, setRegisterPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [legalDoc, setLegalDoc] = useState<LegalDoc | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);

  // Supabase's implicit OAuth flow (used by handleGoogleAuth below) redirects back here with
  // the session in the URL fragment rather than a query string or POST body — pick it up once
  // on mount, since /auth/v1/authorize never round-trips through our own backend.
  useEffect(() => {
    if (!window.location.hash.includes('access_token=')) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const expiresIn = Number(params.get('expires_in') ?? '3600');
    window.history.replaceState(null, '', window.location.pathname);
    if (!accessToken || !refreshToken) return;
    (async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
        });
        const user = await res.json();
        if (!res.ok || !user?.id) {
          setError(t.webAuth.connectionError);
          return;
        }
        setWebSession({
          accessToken,
          refreshToken,
          userId: user.id,
          email: user.email ?? '',
          expiresAt: Date.now() + expiresIn * 1000,
        });
        setStage('unlocked');
      } catch {
        setError(t.webAuth.connectionError);
      }
    })();
    // Runs once on mount to consume the OAuth redirect fragment, if any.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGoogleAuth = () => {
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    window.location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
  };

  const showToast = (text: string) => {
    setToast(text);
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 5000);
  };

  const switchMode = (next: PanelMode) => {
    setMode(next);
    setError('');
  };

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error_description || data?.msg || t.webAuth.invalidCredentials);
        return;
      }
      const session: WebSession = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        userId: data.user?.id,
        email,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      };
      setWebSession(session);
      setStage('unlocked');
    } catch {
      setError(t.webAuth.connectionError);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const rEmail = registerEmail.trim();
    if (!rEmail || !registerPassword || !registerPasswordConfirm) {
      setError(t.webAuth.fillAllFieldsError);
      return;
    }
    if (registerPassword !== registerPasswordConfirm) {
      setError(t.webAuth.passwordMismatchError);
      return;
    }
    if (registerPassword.length < 6) {
      setError(t.webAuth.passwordTooShortError);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ email: rEmail, password: registerPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error_description || data?.msg || t.webAuth.registerFailedError);
        return;
      }
      const needsConfirmation = !data?.access_token;
      setRegisterEmail('');
      setRegisterPassword('');
      setRegisterPasswordConfirm('');
      setEmail(rEmail);
      setPassword('');
      setMode('login');
      showToast(needsConfirmation ? t.webAuth.registerNeedsConfirmationToast : t.webAuth.registerSuccessToast);
    } catch {
      setError(t.webAuth.connectionError);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    const targetEmail = email.trim();
    if (!targetEmail) {
      setError(t.webAuth.resetPasswordNeedsEmailError);
      return;
    }
    setResettingPassword(true);
    setError('');
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
        body: JSON.stringify({ email: targetEmail }),
      });
      if (!res.ok) {
        setError(t.webAuth.resetPasswordError);
        return;
      }
      showToast(t.webAuth.resetPasswordSentToast);
    } catch {
      setError(t.webAuth.connectionError);
    } finally {
      setResettingPassword(false);
    }
  };

  const handleDemoMode = () => {
    // The web build already installs the real Supabase-backed webApi.ts before this component
    // mounts (see main.tsx), so installMockApiIfNeeded()'s "window.api already defined" guard
    // would normally no-op. Clearing it first forces the mock NodeApi in instead, giving
    // visitors a UI/UX preview without touching real Supabase/Edge Function auth — desktop's
    // demo mode instead opens the main window with no session at all, which isn't an option
    // here since the web Edge Functions require a verified JWT on every call.
    delete (window as unknown as { api?: unknown }).api;
    installMockApiIfNeeded();
    setStage('unlocked');
  };

  if (stage === 'unlocked') return <>{children}</>;

  return (
    <div className="web-auth-gate">
      <div className="web-auth-gate-bg">
        <DomeGallery
          grayscale
          fit={1}
          minRadius={1900}
          autoRotate
          autoRotateSpeed={0.02}
          overlayBlurColor="#eceef1"
        />
      </div>
      <WebAuthHeader onSignIn={() => switchMode('login')} onSignUp={() => switchMode('register')} onOpenLegal={setLegalDoc} />
      <div className={`web-auth-toast ${toastVisible ? 'visible' : ''}`}>{toast}</div>
      <div className="web-auth-card">
        <section className="web-auth-form-side">
          <div className="web-auth-form-col">
            <h1 className="web-auth-title">{mode === 'login' ? t.webAuth.loginTitle : t.webAuth.registerTitle}</h1>
            <p className="web-auth-subtitle">{mode === 'login' ? t.webAuth.loginSubtitle : t.webAuth.registerSubtitle}</p>

            <form className="web-auth-fields" onSubmit={mode === 'login' ? handleLogin : handleRegister}>
              {mode === 'login' ? (
                <>
                  <label className="web-auth-field">
                    <span className="web-auth-field-label">{t.webAuth.emailLabel}</span>
                    <span className="web-auth-input-wrap">
                      <input
                        className="web-auth-input"
                        type="email"
                        placeholder={t.webAuth.emailLabel}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="username"
                        required
                      />
                    </span>
                  </label>
                  <label className="web-auth-field">
                    <span className="web-auth-field-label">{t.webAuth.passwordLabel}</span>
                    <span className="web-auth-input-wrap">
                      <input
                        className="web-auth-input"
                        type={showPassword ? 'text' : 'password'}
                        placeholder={t.webAuth.passwordLabel}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="current-password"
                        required
                      />
                      <button
                        type="button"
                        className="web-auth-eye-btn"
                        onClick={() => setShowPassword((v) => !v)}
                        tabIndex={-1}
                      >
                        {showPassword ? <IconEyeOff size={17} /> : <IconEye size={17} />}
                      </button>
                    </span>
                  </label>
                  <div className="web-auth-field-row">
                    <label className="web-auth-checkbox-label">
                      <input type="checkbox" className="web-auth-checkbox" />
                      {t.webAuth.keepSignedIn}
                    </label>
                    <button
                      type="button"
                      className="web-auth-text-link"
                      onClick={handleResetPassword}
                      disabled={resettingPassword}
                    >
                      {t.webAuth.resetPasswordLink}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label className="web-auth-field">
                    <span className="web-auth-field-label">{t.webAuth.emailLabel}</span>
                    <span className="web-auth-input-wrap">
                      <input
                        className="web-auth-input"
                        type="email"
                        placeholder={t.webAuth.emailLabel}
                        value={registerEmail}
                        onChange={(e) => setRegisterEmail(e.target.value)}
                        autoComplete="username"
                      />
                    </span>
                  </label>
                  <label className="web-auth-field">
                    <span className="web-auth-field-label">{t.webAuth.passwordLabel}</span>
                    <span className="web-auth-input-wrap">
                      <input
                        className="web-auth-input"
                        type={showPassword ? 'text' : 'password'}
                        placeholder={t.webAuth.passwordLabel}
                        value={registerPassword}
                        onChange={(e) => setRegisterPassword(e.target.value)}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        className="web-auth-eye-btn"
                        onClick={() => setShowPassword((v) => !v)}
                        tabIndex={-1}
                      >
                        {showPassword ? <IconEyeOff size={17} /> : <IconEye size={17} />}
                      </button>
                    </span>
                  </label>
                  <label className="web-auth-field">
                    <span className="web-auth-field-label">{t.webAuth.repeatPasswordLabel}</span>
                    <span className="web-auth-input-wrap">
                      <input
                        className="web-auth-input"
                        type={showPassword ? 'text' : 'password'}
                        placeholder={t.webAuth.repeatPasswordLabel}
                        value={registerPasswordConfirm}
                        onChange={(e) => setRegisterPasswordConfirm(e.target.value)}
                        autoComplete="new-password"
                      />
                    </span>
                  </label>
                </>
              )}

              <button className="web-auth-submit" type="submit" disabled={loading}>
                {mode === 'login'
                  ? loading
                    ? t.webAuth.checkingBtn
                    : t.webAuth.loginBtn
                  : loading
                    ? t.webAuth.registeringBtn
                    : t.webAuth.registerSubmitBtn}
              </button>
            </form>

            {error && <div className="login-error">{error}</div>}

            <div className="web-auth-divider">
              <span>{t.webAuth.orDivider}</span>
            </div>
            <button className="web-auth-google-btn" type="button" onClick={handleGoogleAuth}>
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"
                />
                <path
                  fill="#34A853"
                  d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z"
                />
                <path
                  fill="#FBBC05"
                  d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.03l2.99-2.33z"
                />
                <path
                  fill="#EA4335"
                  d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.97l2.99 2.33C4.66 5.17 6.65 3.58 9 3.58z"
                />
              </svg>
              {t.webAuth.googleBtn}
            </button>

            <p className="web-auth-switch-mode">
              {mode === 'login' ? t.webAuth.switchToRegisterText : t.webAuth.switchToLoginText}{' '}
              <button type="button" className="web-auth-text-link" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
                {mode === 'login' ? t.webAuth.registerToggleBtn : t.webAuth.backToLoginBtn}
              </button>
            </p>

            <button className="web-auth-demo-link" type="button" onClick={handleDemoMode}>
              {t.webAuth.demoModeLink}
            </button>
          </div>
        </section>

        <section className="web-auth-media-side">
          <video className="web-auth-bg-video" src="/login-bg.webm" autoPlay loop muted playsInline />
        </section>
      </div>
      <div className="web-auth-footer">
        <button className="legal-link" onClick={() => setLegalDoc('privacy')}>
          {t.legal.privacyLink}
        </button>
        <button className="legal-link" onClick={() => setLegalDoc('terms')}>
          {t.legal.termsLink}
        </button>
        <button className="legal-link" onClick={() => setLegalDoc('refund')}>
          {t.legal.refundLink}
        </button>
      </div>
      {legalDoc && <LegalModal doc={legalDoc} onClose={() => setLegalDoc(null)} />}
    </div>
  );
}
