import type { FC } from 'react';
import type { Translations } from './i18n';
import {
  IconChat,
  IconFlow,
  IconGauge,
  IconMusic,
  IconRocket,
  IconSparkles,
  IconTarget,
  IconTrend,
  IconVideo,
} from './components/Icons';

export type AppView =
  | 'home'
  | 'canvas'
  | 'text'
  | 'generate'
  | 'evaluate'
  | 'onelaunch'
  | 'musicaudio'
  | 'motion'
  | 'strategy'
  | 'assets'
  | 'trends';

export interface ModeDef {
  value: AppView;
  label: string;
  icon: FC<{ size?: number }>;
  description: string;
  badge?: 'new' | 'beta';
}

// One list for the side menu, the header search and the home screen tiles, so the three never
// drift apart. Web-only modes are dropped on desktop (same gating App.tsx always had).
export function buildModes(t: Translations, web: boolean): ModeDef[] {
  const d = t.home.modeDescriptions;
  const all: (ModeDef & { webOnly?: boolean })[] = [
    { value: 'canvas', label: t.modeSwitch.nodesAndAdapt, icon: IconFlow, description: d.canvas },
    { value: 'generate', label: t.modeSwitch.quickGeneration, icon: IconSparkles, description: d.generate },
    { value: 'text', label: t.modeSwitch.textWork, icon: IconChat, description: d.text },
    { value: 'trends', label: t.trends.heading, icon: IconTrend, description: d.trends, webOnly: true },
    { value: 'evaluate', label: t.modeSwitch.evaluation, icon: IconGauge, description: d.evaluate, webOnly: true },
    { value: 'onelaunch', label: t.modeSwitch.oneLaunch, icon: IconRocket, description: d.onelaunch, badge: 'beta', webOnly: true },
    { value: 'musicaudio', label: t.modeSwitch.musicAudio, icon: IconMusic, description: d.musicaudio, webOnly: true },
    { value: 'motion', label: t.modeSwitch.motionEngine, icon: IconVideo, description: d.motion, badge: 'new', webOnly: true },
    { value: 'strategy', label: t.modeSwitch.strategy, icon: IconTarget, description: d.strategy, webOnly: true },
  ];
  return all.filter((m) => web || !m.webOnly).map(({ webOnly: _w, ...m }) => m);
}
