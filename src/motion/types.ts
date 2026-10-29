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

// The animation Claude Opus writes itself (motion-storyboard, mode 'code'): JavaScript that draws
// any moment of the video on a Canvas 2D, run in src/motion/sandbox.ts. beats describe the scenes to
// the user; clips say when and from which second each video material plays.
export interface MotionBeat {
  start: number;
  end: number;
  text: string;
}

// One cut of a video material: shown from `start` to `end` of the clip, starting at second `from`
// of the video itself; several clips of one video make a montage. volume: its own sound, 0…1.
export interface MotionClip {
  asset: number;
  start: number;
  end: number;
  from: number;
  volume?: number; // absent on compositions made before sound was mixed: 1
}

// An audio material under the whole video, from second `from` of the track; the engine lowers it
// under clips that keep their sound and fades it out at the end.
export interface MotionMusic {
  asset: number;
  from: number;
  volume: number;
}

export interface MotionComposition {
  title: string;
  concept: string;
  duration: number;
  background: string;
  palette: string[];
  beats: MotionBeat[];
  clips: MotionClip[];
  music?: MotionMusic | null;
  warnings?: string[]; // what Opus wants the user to know (a video too long for the clip, etc.)
  code: string;
}

// What the browser found in a video material (src/motion/footage.ts), so Opus can edit it: its
// shots, a keyframe per notable shot with its time, and where there is sound.
export interface MotionFootage {
  shots: { start: number; dur: number; motion: number }[];
  keyframes: { t: number; jpeg: string }[];
  audio: { has: boolean; loud: [number, number][] }; // seconds with clear sound (speech, music)
}

export interface MotionAsset {
  id: string;
  kind: 'image' | 'video' | 'audio';
  name: string;
  blob: Blob;
  width: number; // 0 for audio
  height: number;
  duration?: number; // video and audio, seconds
  footage?: MotionFootage; // video, once analysed
}

export interface MotionVariant {
  id: string;
  createdAt: string;
  // one of the two: a storyboard for the template renderer (variants made before Opus wrote the
  // animation itself) or Opus's own animation code
  storyboard?: MotionStoryboard;
  composition?: MotionComposition;
  posters?: string[]; // composition: small JPEG frames from the check, for the card
  aspect: string; // the frame the board was composed for; rendering may pick another
  assetIds: string[]; // storyboard asset indexes → these assets, frozen at generation time
  costUsd: number;
  styleName?: string; // the chosen style direction, if one was pinned
  fromReference?: boolean; // made to mirror the uploaded reference
}

// A reference the video should look like (src/motion/reference.ts). Only this summary is sent to
// the model; the reference file itself never ends up in the video.
export interface MotionReferenceShot {
  start: number;
  dur: number;
  motion: number; // mean frame-to-frame change inside the shot, 0…1
}

export interface MotionReferenceInfo {
  kind: 'video' | 'images';
  duration: number; // 0 for images
  width: number;
  height: number;
  shots: MotionReferenceShot[];
  palette: string[];
  frames: string[]; // JPEG data URLs: one per shot (video) or per image
  frameShots: number[]; // frames[i] belongs to shots[frameShots[i]]
}

// What Opus gets of one material: pictures (a photo; a video's keyframes, frameTimes saying where
// each is) and, for a video, its shots and sound; for audio just its length.
export interface MotionAssetForModel {
  kind: 'image' | 'video' | 'audio';
  name: string;
  duration?: number;
  frames: string[];
  frameTimes?: number[];
  width?: number;
  height?: number;
  shots?: MotionFootage['shots'];
  audio?: MotionFootage['audio'];
}

export interface MotionStoryboardRequest {
  brief: string;
  duration: number;
  aspect: string;
  assets: MotionAssetForModel[];
  previous: string[];
  style?: MotionStyleDirection | null;
  reference?: MotionReferenceInfo | null;
}

// The browser ran a composition and it failed: Opus gets it back with the error.
export interface MotionFixRequest {
  brief: string;
  duration: number;
  aspect: string;
  assets: { kind: 'image' | 'video' | 'audio'; name: string; duration?: number }[];
  composition: MotionComposition;
  error: string;
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
// Montage material limits: the browser decodes a whole file to cut its sound, so longer or heavier
// files are refused with a message rather than crashing the tab (an iPad above all).
export const MOTION_MAX_VIDEO_SECONDS = 300;
export const MOTION_MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const MOTION_MAX_AUDIO_SECONDS = 600;
export const MOTION_MAX_AUDIO_BYTES = 100 * 1024 * 1024;
