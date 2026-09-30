// Motion Engine storyboard — the JSON the motion-storyboard Edge Function returns (Claude Opus
// 5.5 writes it, the function normalizes it). One storyboard is both the static board the user
// reviews and the exact script src/motion/render.ts animates, so what they approve is what renders.

export type MotionLayout = 'full' | 'split-left' | 'split-right' | 'center-card' | 'grid' | 'text-only' | 'caption-bottom';
export type MotionCamera = 'static' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down';
export type MotionTextAnim = 'fade-up' | 'slide-left' | 'scale' | 'mask-up' | 'words' | 'type';
export type MotionTransition = 'cut' | 'fade' | 'slide' | 'zoom' | 'wipe';
export type MotionFont = 'sans' | 'serif' | 'mono' | 'display';

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
  style: { bg: string; ink: string; accent: string; font: MotionFont; mood: string };
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
}

export interface MotionStoryboardRequest {
  brief: string;
  duration: number;
  aspect: string;
  assets: { kind: 'image' | 'video'; name: string; duration?: number; frames: string[] }[];
  previous: string[];
}

export const MOTION_DURATIONS = [6, 10, 15, 20, 30, 45, 60] as const;
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
