import { useEffect, useRef, useState } from 'react';
import {
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
import { handleDockMouseMove, handleDockMouseLeave } from '../dockHover';

interface MusicAudioPanelProps {
  active: boolean;
}

const LOADING_MESSAGE_INTERVAL_MS = 1400;
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

  return (
    <div className={`musicaudio-panel ${active ? '' : 'musicaudio-hidden'}`}>
      <div
        className="musicaudio-mode-toolbar"
        onMouseMove={handleDockMouseMove}
        onMouseLeave={handleDockMouseLeave}
      >
        <button
          className={`toolbar-label-btn ${mode === 'music' ? 'active' : ''}`}
          onClick={() => switchMode('music')}
          data-dock-item
        >
          <IconMusic size={13} /> {t.musicAudio.modeToggleMusic}
        </button>
        <button
          className={`toolbar-label-btn ${mode === 'speech' ? 'active' : ''}`}
          onClick={() => switchMode('speech')}
          data-dock-item
        >
          <IconMic size={13} /> {t.musicAudio.modeToggleSpeech}
        </button>
      </div>
      <div className="musicaudio-layout">
        <div className="musicaudio-side">
          {mode === 'music' ? (
            <>
              <span className="field-label">{t.musicAudio.musicPromptLabel}</span>
              <textarea
                className="node-textarea musicaudio-textarea"
                value={musicPrompt}
                onChange={(e) => setMusicPrompt(e.target.value)}
                placeholder={t.musicAudio.musicPromptPlaceholder}
              />
              <span className="field-label">{t.musicAudio.genreLabel}</span>
              <div className="musicaudio-genre-grid">
                {MUSIC_GENRES.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`musicaudio-genre-btn ${genre === g ? 'active' : ''}`}
                    onClick={() => setGenre(genre === g ? null : g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <span className="field-label">{t.musicAudio.lyricsLabel}</span>
              <textarea
                className="node-textarea musicaudio-textarea musicaudio-lyrics"
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                placeholder={t.musicAudio.lyricsPlaceholder}
              />
              <span className="field-label">{t.musicAudio.formatLabel}</span>
              <select className="node-select" value={format} onChange={(e) => setFormat(e.target.value)}>
                {AUDIO_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f.toUpperCase()}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <span className="field-label">{t.musicAudio.phraseLabel}</span>
              <textarea
                className="node-textarea musicaudio-textarea"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={t.musicAudio.phrasePlaceholder}
              />
              <span className="field-label">{t.musicAudio.speechPromptLabel}</span>
              <textarea
                className="node-textarea musicaudio-textarea"
                value={speechPrompt}
                onChange={(e) => setSpeechPrompt(e.target.value)}
                placeholder={t.musicAudio.speechPromptPlaceholder}
              />
              <span className="field-label">{t.musicAudio.voiceLabel}</span>
              <div className="musicaudio-voice-list">
                {TTS_VOICES.map((v) => (
                  <div key={v} className={`musicaudio-voice-row ${voice === v ? 'selected' : ''}`} onClick={() => setVoice(v)}>
                    <span>{v}</span>
                    <button
                      type="button"
                      className="musicaudio-voice-preview-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handlePreviewVoice(v);
                      }}
                      title={t.musicAudio.previewTooltip}
                      disabled={previewingVoice === v}
                    >
                      {previewingVoice === v ? <IconRefresh size={11} /> : <IconPlay size={10} />}
                    </button>
                  </div>
                ))}
              </div>
              <span className="field-label">{t.musicAudio.languageLabel}</span>
              <select className="node-select" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {TTS_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </>
          )}

          <button
            className="generate-btn musicaudio-generate-btn"
            onClick={handleGenerate}
            disabled={status === 'loading'}
          >
            {status === 'loading' ? t.musicAudio.generatingBtn : t.musicAudio.generateBtn}
          </button>
          {status === 'error' && <div className="error-text">{error}</div>}
        </div>

        <div className="musicaudio-result-area">
          {status === 'loading' && (
            <div className="musicaudio-loading-bar">
              <span className="musicaudio-loading-corner">{loadingMessages[loadingMessageIndex]}</span>
            </div>
          )}

          {status !== 'loading' && result && (
            <div className="musicaudio-player">
              <div className="musicaudio-player-top">
                <span className="musicaudio-player-type-icon">
                  {result.mode === 'music' ? <IconMusic size={14} /> : <IconMic size={14} />}
                </span>
                <button className="musicaudio-download-btn" onClick={download} title={t.musicAudio.downloadTooltip}>
                  <IconDownload size={13} />
                </button>
              </div>
              <div className="musicaudio-player-controls">
                <button className="musicaudio-play-btn" onClick={togglePlay}>
                  {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
                </button>
                <input
                  type="range"
                  className="musicaudio-scrubber"
                  min={0}
                  max={duration || 0}
                  value={currentTime}
                  onChange={(e) => seek(Number(e.target.value))}
                />
                <span className="musicaudio-time">
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

          {status === 'idle' && !result && <div className="connected-hint musicaudio-empty-hint">{t.musicAudio.subtitle}</div>}
        </div>
      </div>
      <audio ref={previewAudioRef} />
    </div>
  );
}
