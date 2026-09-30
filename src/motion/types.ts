// Motion Engine storyboard — the JSON the motion-storyboard Edge Function returns (Claude Opus
// 5.5 writes it, the function normalizes it). One storyboard is both the static board the user
// reviews and the exact script src/motion/render.ts animates, so what they approve is what renders.

export type MotionLayout = 'full' | 'split-left' | 'split-right' | 'center-card' | 'grid' | 'text-only' | 'caption-bottom';
export type MotionCamera = 'static' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down' | 'drift';
export type MotionTextAnim = 'fade-up' | 'slide-left' | 'scale' | 'mask-up' | 'words' | 'type' | 'blur-in' | 'tracking';
export type MotionTransition = 'cut' | 'fade' | 'slide' | 'zoom' | 'wipe' | 'glitch' | 'flash' | 'blur' | 'push-up';
export type MotionFont = 'sans' | 'serif' | 'mono' | 'display';
// Whole-video looks layered over every frame (src/motion/render.ts → applyFx).
export type MotionFx = 'grain' | 'glow' | 'vignette' | 'letterbox' | 'duotone';
export type MotionPace = 'calm' | 'medium' | 'fast';

export interface MotionStyle {
  bg: string;
  ink: string;
  accent: string;
  font: MotionFont;
  mood: string;
  fx?: MotionFx[]; // absent on storyboards made before effects existed
}

// A style direction Claude proposes on «Предложи стили»; picking one pins the next storyboards to it.
export interface MotionStyleDirection {
  id: string;
  name: string;
  description: string;
  sample: string; // a short on-screen line in this voice, used on the style card's example frame
  style: MotionStyle;
  pace: MotionPace;
  layouts: MotionLayout[];
  cameras: MotionCamera[];
  textAnims: MotionTextAnim[];
  transitions: MotionTransition[];
}

export interface MotionScene {
  start: number;
  dur: number;
  layout: MotionLayout;
  asset: number | null; // index into the variant's asset list
  assets: number[]; // grid layout only
  headline: string;
  sub: string;
  cta: string;
  camera: MotionCamera;
  textAnim: MotionTextAnim;
  transition: MotionTransition;
  bg: string; // '' = style.bg
  note: string;
}

export interface MotionStoryboard {
  title: string;
  concept: string;
  style: MotionStyle;
  duration: number;
  scenes: MotionScene[];
}

export interface MotionAsset {
  id: string;
  kind: 'image' | 'video';
  name: string;
  blob: Blob;
  width: number;
  height: number;
  duration?: number; // video only, seconds
}

export interface MotionVariant {
  id: string;
  createdAt: string;
  storyboard: MotionStoryboard;
  aspect: string; // the frame the board was composed for; rendering may pick another
  assetIds: string[]; // storyboard asset indexes → these assets, frozen at generation time
  costUsd: number;
  styleName?: string; // the chosen style direction, if one was pinned
}

export interface MotionStoryboardRequest {
  brief: string;
  duration: number;
  aspect: string;
  assets: { kind: 'image' | 'video'; name: string; duration?: number; frames: string[] }[];
  previous: string[];
  style?: MotionStyleDirection | null;
}

export interface MotionStylesRequest {
  brief: string;
  duration: number;
  aspect: string;
  assets: MotionStoryboardRequest['assets'];
  previous: string[]; // names of directions already proposed
}

export const MOTION_MIN_DURATION = 3;
export const MOTION_MAX_DURATION = 60;
export const MOTION_DURATION_MARKS = [3, 15, 30, 45, 60] as const;
// «Свой размер»: any width × height within these bounds (rounded to even numbers for H.264).
export const MOTION_CUSTOM_MIN = 128;
export const MOTION_CUSTOM_MAX = 4096;
export const MOTION_ASPECTS = ['16:9', '9:16', '1:1', '4:5', '4:3', '3:4', '21:9', '2:3'] as const;
// Short side of the frame; the long side follows from the aspect ratio.
export const MOTION_QUALITIES = [
  { id: '720', short: 720, label: '720p' },
  { id: '1080', short: 1080, label: '1080p' },
  { id: '1440', short: 1440, label: '2K' },
  { id: '2160', short: 2160, label: '4K' },
] as const;
export const MOTION_FPS = [24, 30, 60] as const;
export const MOTION_MAX_ASSETS = 8;
