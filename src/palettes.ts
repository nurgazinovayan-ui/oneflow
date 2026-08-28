// Curated color palettes for the "One Launch" mode (product photo → full ad campaign, see
// src/components/OneLaunchPanel.tsx). Each palette's `colors` describe the intended background/
// lighting mood fed into the image-generation prompt; `accent` is the single most saturated
// tone, used for on-image badge/text styling in the client-side marketplace-card compositor
// (see src/imageCompositor.ts) so the overlay visually matches the generated photo's palette.
export interface ProductPalette {
  key: string;
  name: string;
  colors: string[];
  accent: string;
}

export const PRODUCT_PALETTES: ProductPalette[] = [
  { key: 'sunset', name: 'Тёплый закат', colors: ['#E85D3D', '#F4A261', '#F7D9A0', '#6B3226'], accent: '#E85D3D' },
  { key: 'mono-gold', name: 'Минимализм Ч/Б', colors: ['#0A0A0A', '#FFFFFF', '#C9A227'], accent: '#C9A227' },
  { key: 'pastel-fresh', name: 'Пастельная свежесть', colors: ['#FDE2E4', '#E2ECE9', '#BEE1E6', '#F0EFEB'], accent: '#BEE1E6' },
  { key: 'deep-sea', name: 'Морская глубина', colors: ['#023047', '#219EBC', '#8ECAE6', '#FFB703'], accent: '#219EBC' },
  { key: 'berry-mix', name: 'Ягодный микс', colors: ['#6A0572', '#AB0967', '#FF6B6B', '#FFD166'], accent: '#AB0967' },
  { key: 'eco-natural', name: 'Эко/натуральный', colors: ['#606C38', '#283618', '#FEFAE0', '#DDA15E'], accent: '#606C38' },
  { key: 'luxe-gold', name: 'Люкс золото', colors: ['#1A1A1A', '#C9A227', '#E8D9B5', '#FFFFFF'], accent: '#C9A227' },
  { key: 'neon-cyberpunk', name: 'Неоновый киберпанк', colors: ['#0D0221', '#FF00A0', '#00F0FF', '#260B4A'], accent: '#FF00A0' },
  { key: 'coffee-cream', name: 'Кофе и крем', colors: ['#3E2723', '#6F4E37', '#D7CCC8', '#EFEBE9'], accent: '#6F4E37' },
  { key: 'mint-fresh', name: 'Мятная свежесть', colors: ['#A8E6CF', '#DCEDC1', '#FFD3B6', '#FFAAA5'], accent: '#A8E6CF' },
  { key: 'royal-blue', name: 'Королевский синий', colors: ['#14213D', '#FCA311', '#E5E5E5', '#000000'], accent: '#FCA311' },
  { key: 'terracotta', name: 'Терракота', colors: ['#C1440E', '#E9C46A', '#2A9D8F', '#264653'], accent: '#C1440E' },
  { key: 'rose-quartz', name: 'Розовый кварц', colors: ['#F7CAC9', '#92A8D1', '#F4E1D2', '#034F84'], accent: '#92A8D1' },
  { key: 'industrial', name: 'Индустриальный минимализм', colors: ['#2B2D42', '#8D99AE', '#EDF2F4', '#EF233C'], accent: '#EF233C' },
  { key: 'tropical', name: 'Тропический сок', colors: ['#FF6F59', '#FFC857', '#2E86AB', '#06A77D'], accent: '#FF6F59' },
];
