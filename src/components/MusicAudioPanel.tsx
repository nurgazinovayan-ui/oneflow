import { useEffect, useRef, useState } from 'react';
import {
  IconChevronDown,
  IconDownload,
  IconMic,
  IconMusic,
  IconPause,
  IconPlay,
  IconRefresh,
} from './Icons';
import { AUDIO_FORMATS, MUSIC_GENRES, TTS_LANGUAGES, TTS_VOICES, type AudioMode } from '../types';
import { formatGenerationError } from '../errorMessages';
import { useT } from '../i18n';

interface MusicAudioPanelProps {
  active: boolean;
}

const LOADING_MESSAGE_INTERVAL_MS = 1400;
// Decorative waveform for the player: fixed pseudo-random bar heights (no audio decoding), the
// played part is tinted with the accent.
const WAVE_BARS = Array.from({ length: 72 }, (_, i) => 18 + Math.round(Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.45)) * 82));
const PREVIEW_PHRASES: Record<string, string> = {
  'ru-RU': 'Привет, это пример голоса.',
  'en-US': 'Hello, this is a voice sample.',
  'kk-KZ': 'Сәлем, бұл дауыс үлгісі.',
  'es-ES': 'Hola, esta es una muestra de voz.',
  'de-DE': 'Hallo, das ist eine Sprachprobe.',
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Web-only for now (see App.tsx — gated behind VITE_WEB_MODE, same as Evaluation/One Launch).
// Two very different generation shapes — a song from a style prompt + lyrics, or a spoken
// phrase in a chosen voice/language — behind one toggle, both funneled through the single
// generateAudio API call (see src/webApi.ts + supabase/functions/generate-audio).
export default function MusicAudioPanel({ active }: MusicAudioPanelProps) {
  const t = useT();
  const [mode, setMode] = useState<AudioMode>('music');
  const [musicPrompt, setMusicPrompt] = useState('');
  const [genre, setGenre] = useState<string | null>(null);
  const [lyrics, setLyrics] = useState('');
  const [format, setFormat] = useState<string>(AUDIO_FORMATS[0]);
  const [phrase, setPhrase] = useState('');
  const [speechPrompt, setSpeechPrompt] = useState('');
  const [voice, setVoice] = useState<string>(TTS_VOICES[0]);
  const [language, setLanguage] = useState<string>(TTS_LANGUAGES[0].code);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);

  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ url: string; mode: AudioMode } | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewAudioRef = useRef<HTMLAudioElement>(null);

  const loadingMessages = mode === 'music' ? t.musicAudio.loadingMessagesMusic : t.musicAudio.loadingMessagesSpeech;

  useEffect(() => {
    if (status !== 'loading') return;
    setLoadingMessageIndex(0);
    const id = setInterval(() => {
      setLoadingMessageIndex((i) => (i + 1) % loadingMessages.length);
    }, LOADING_MESSAGE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status, loadingMessages.length]);

  const switchMode = (next: AudioMode) => {
    setMode(next);
    setError('');
  };

  const handlePreviewVoice = async (voiceName: string) => {
    if (previewingVoice) return;
    setPreviewingVoice(voiceName);
    try {
      const url = await window.api.generateAudio({
        mode: 'speech',
        text: PREVIEW_PHRASES[language] ?? PREVIEW_PHRASES['en-US'],
        voice: voiceName,
        language,
      });
      const audio = previewAudioRef.current;
      if (audio) {
        audio.src = url;
        void audio.play();
      }
    } catch {
      // Best-effort preview — a failed sample isn't worth surfacing as a hard error.
    } finally {
      setPreviewingVoice(null);
    }
  };

  const handleGenerate = async () => {
    if (mode === 'music' && !musicPrompt.trim()) {
      setStatus('error');
      setError(t.musicAudio.noPromptError);
      return;
    }
    if (mode === 'speech' && !phrase.trim()) {
      setStatus('error');
      setError(t.musicAudio.noPhraseError);
      return;
    }
    setStatus('loading');
    setError('');
    setResult(null);
    try {
      const musicStylePrompt = [genre, musicPrompt.trim()].filter(Boolean).join(', ');
      const url = await window.api.generateAudio(
        mode === 'music'
          ? { mode, prompt: musicStylePrompt, lyrics: lyrics.trim(), format }
          : { mode, text: phrase.trim(), prompt: speechPrompt.trim(), voice, language }
      );
      setResult({ url, mode });
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(formatGenerationError(err));
    }
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) audio.pause();
    else void audio.play();
  };

  const seek = (value: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setCurrentTime(value);
  };

  const download = () => {
    if (result) void window.api.saveFile(result.url, `${result.mode === 'music' ? 'track' : 'speech'}.${format}`);
  };

  const progress = duration > 0 ? currentTime / duration : 0;
  const wave = (played: number) => (
    <div className="v2-wave" aria-hidden="true">
      {WAVE_BARS.map((h, i) => (
        <i key={i} style={{ height: `${h}%` }} className={i / WAVE_BARS.length < played ? 'on' : ''} />
      ))}
    </div>
  );

  return (
    <div className={`musicaudio-panel v2-mode v2-split v2-music ${active ? '' : 'musicaudio-hidden'}`}>
      <section className="v2-card v2-music-form">
        <div className="v2-chips" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'music'} className={`v2-chip${mode === 'music' ? ' on' : ''}`} onClick={() => switchMode('music')}>
            <IconMusic size={13} /> {t.musicAudio.modeToggleMusic}
          </button>
          <button type="button" role="tab" aria-selected={mode === 'speech'} className={`v2-chip${mode === 'speech' ? ' on' : ''}`} onClick={() => switchMode('speech')}>
            <IconMic size={13} /> {t.musicAudio.modeToggleSpeech}
          </button>
        </div>
        <div className="v2-scroll">
          {mode === 'music' ? (
            <>
              <div className="v2-lab">
                <span>{t.musicAudio.musicPromptLabel}</span>
              </div>
              <textarea
                className="v2-field"
                rows={3}
                value={musicPrompt}
                onChange={(e) => setMusicPrompt(e.target.value)}
                placeholder={t.musicAudio.musicPromptPlaceholder}
              />
              <div className="v2-lab">
                <span>{t.musicAudio.genreLabel}</span>
              </div>
              <div className="v2-chips">
                {MUSIC_GENRES.map((g) => (
                  <button key={g} type="button" className={`v2-chip${genre === g ? ' on' : ''}`} onClick={() => setGenre(genre === g ? null : g)}>
                    {g}
                  </button>
                ))}
              </div>
              <div className="v2-lab">
                <span>{t.musicAudio.lyricsLabel}</span>
              </div>
              <textarea
                className="v2-field"
                rows={4}
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                placeholder={t.musicAudio.lyricsPlaceholder}
              />
              <div className="v2-lab">
                <span>{t.musicAudio.formatLabel}</span>
              </div>
              <div className="v2-select">
                <select value={format} onChange={(e) => setFormat(e.target.value)} aria-label={t.musicAudio.formatLabel}>
                  {AUDIO_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f.toUpperCase()}
                    </option>
                  ))}
                </select>
                <IconChevronDown size={13} />
              </div>
            </>
          ) : (
            <>
              <div className="v2-lab">
                <span>{t.musicAudio.phraseLabel}</span>
              </div>
              <textarea
                className="v2-field"
                rows={3}
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={t.musicAudio.phrasePlaceholder}
              />
              <div className="v2-lab">
                <span>{t.musicAudio.speechPromptLabel}</span>
              </div>
              <textarea
                className="v2-field"
                rows={2}
                value={speechPrompt}
                onChange={(e) => setSpeechPrompt(e.target.value)}
                placeholder={t.musicAudio.speechPromptPlaceholder}
              />
              <div className="v2-lab">
                <span>{t.musicAudio.voiceLabel}</span>
              </div>
              <div className="v2-list" role="radiogroup" aria-label={t.musicAudio.voiceLabel}>
                {TTS_VOICES.map((v) => (
                  <div key={v} className={`v2-row${voice === v ? ' on' : ''}`}>
                    <button type="button" role="radio" aria-checked={voice === v} className="v2-row-main" onClick={() => setVoice(v)}>
                      {v}
                    </button>
                    <button
                      type="button"
                      className="v2-icon-btn"
                      onClick={() => void handlePreviewVoice(v)}
                      title={t.musicAudio.previewTooltip}
                      aria-label={`${t.musicAudio.previewTooltip}: ${v}`}
                      disabled={previewingVoice === v}
                    >
                      {previewingVoice === v ? <IconRefresh size={11} /> : <IconPlay size={10} />}
                    </button>
                  </div>
                ))}
              </div>
              <div className="v2-lab">
                <span>{t.musicAudio.languageLabel}</span>
              </div>
              <div className="v2-select">
                <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label={t.musicAudio.languageLabel}>
                  {TTS_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <IconChevronDown size={13} />
              </div>
            </>
          )}
        </div>
        <div className="v2-card-foot">
          <button type="button" className="v2-cta" onClick={handleGenerate} disabled={status === 'loading'}>
            {mode === 'music' ? <IconMusic size={15} /> : <IconMic size={15} />}
            {status === 'loading' ? t.musicAudio.generatingBtn : t.musicAudio.generateBtn}
          </button>
          {status === 'error' && <div className="error-text">{error}</div>}
        </div>
      </section>

      <section className="v2-card v2-music-result">
        {status === 'idle' && !result ? (
          <div className="v2-empty">
            <span className="v2-empty-icon">{mode === 'music' ? <IconMusic size={22} /> : <IconMic size={22} />}</span>
            <h2>{mode === 'music' ? t.ux.musicEmptyTitle : t.ux.speechEmptyTitle}</h2>
            <p>{t.musicAudio.subtitle}</p>
            {mode === 'music' && (
              <div className="v2-examples">
                <span>{t.ux.tryExample}</span>
                {t.ux.musicExamples.map((ex) => (
                  <button key={ex} type="button" className="v2-example" onClick={() => setMusicPrompt(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            )}
            <div className="v2-player ghost" aria-hidden="true">
              <span className="v2-play">
                <IconPlay size={13} />
              </span>
              <span className="v2-track" />
              <span className="v2-time">0:00 / 0:00</span>
            </div>
          </div>
        ) : (
          <>
            <div className="v2-card-head">
              <b>{t.ux.resultsTitle}</b>
              <span>
                {mode === 'music' ? [genre, format.toUpperCase()].filter(Boolean).join(' · ') : voice}
              </span>
            </div>
            {status === 'loading' && (
              <div className="v2-audio-box loading" role="status">
                {wave(0)}
                <div className="v2-progress-note">
                  <span className="v2-spinner" aria-hidden="true" />
                  {loadingMessages[loadingMessageIndex]}
                </div>
              </div>
            )}
            {status === 'error' && !result && <div className="v2-hint">{error}</div>}
            {status !== 'loading' && result && (
              <div className="v2-audio-box">
                <div className="v2-audio-top">
                  <span className="v2-icon-tile">{result.mode === 'music' ? <IconMusic size={15} /> : <IconMic size={15} />}</span>
                  <button
                    type="button"
                    className="v2-icon-btn"
                    onClick={download}
                    title={t.musicAudio.downloadTooltip}
                    aria-label={t.musicAudio.downloadTooltip}
                  >
                    <IconDownload size={14} />
                  </button>
                </div>
                {wave(progress)}
                <div className="v2-player">
                  <button type="button" className="v2-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                    {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
                  </button>
                  <input
                    type="range"
                    className="v2-range"
                    min={0}
                    max={duration || 0}
                    step="any"
                    value={currentTime}
                    onChange={(e) => seek(Number(e.target.value))}
                    style={{ ['--p' as string]: `${progress * 100}%` }}
                  />
                  <span className="v2-time">
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>
                <audio
                  ref={audioRef}
                  src={result.url}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                />
              </div>
            )}
          </>
        )}
      </section>
      <audio ref={previewAudioRef} />
    </div>
  );
}
