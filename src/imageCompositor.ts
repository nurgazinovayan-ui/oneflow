// Client-side "marketplace card" text compositor for One Launch (see OneLaunchPanel.tsx).
// Deliberately NOT asking the image model to render the product name/advantages as pixels —
// vision models are unreliable at precise on-image text (misspellings, garbled letterforms),
// which would look broken on something meant to read as a real product card. Canvas text is
// exact every time, so this draws the AI-generated background photo, then overlays a bottom
// scrim + name + advantage badges on top, and flattens the result back to a single data URL —
// visually the same "text is on the image" result the marketplace-card look calls for.

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for compositing'));
    img.src = dataUrl;
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word;
    if (ctx.measureText(attempt).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = attempt;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// GPT Image 2 only ever returns one of three fixed sizes (1:1, 3:2, 2:3 — a real API
// constraint, not a schema guess) so a template card requesting the 3:4 ratio its own design
// was drawn at gets generated at the closest of those (2:3) and needs trimming down to the
// exact 3:4 the card was designed for — otherwise it reads as taller/narrower than the template
// (visually close to a 9:16 story shape). Center-crops symmetrically either axis, so it works
// regardless of which side the source image is off on.
export async function cropToAspectRatio(dataUrl: string, ratioW: number, ratioH: number): Promise<string> {
  const img = await loadImage(dataUrl);
  const targetRatio = ratioW / ratioH;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const currentRatio = w / h;

  let cropW = w;
  let cropH = h;
  let offsetX = 0;
  let offsetY = 0;
  if (currentRatio > targetRatio) {
    cropW = Math.round(h * targetRatio);
    offsetX = Math.round((w - cropW) / 2);
  } else if (currentRatio < targetRatio) {
    cropH = Math.round(w / targetRatio);
    offsetY = Math.round((h - cropH) / 2);
  }

  const canvas = document.createElement('canvas');
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(img, offsetX, offsetY, cropW, cropH, 0, 0, cropW, cropH);
  return canvas.toDataURL('image/png');
}

export interface MarketplaceCardOptions {
  name: string;
  advantages: string[];
  accentColor: string;
}

export async function composeMarketplaceCard(
  baseDataUrl: string,
  { name, advantages, accentColor }: MarketplaceCardOptions
): Promise<string> {
  const img = await loadImage(baseDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.drawImage(img, 0, 0);

  const w = canvas.width;
  const h = canvas.height;
  const pad = Math.round(w * 0.05);

  // Bottom scrim — guarantees text contrast regardless of what the underlying photo looks
  // like there, the same trick real poster/card overlays use.
  const scrimHeight = h * 0.4;
  const gradient = ctx.createLinearGradient(0, h - scrimHeight, 0, h);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, h - scrimHeight, w, scrimHeight);

  // Advantage badges — up to 4, wrapped left-to-right, pill-shaped, accent-colored fill.
  const shownAdvantages = advantages.filter(Boolean).slice(0, 4);
  const badgeFontSize = Math.max(14, Math.round(w * 0.026));
  ctx.font = `700 ${badgeFontSize}px 'Segoe UI', Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  const badgeH = badgeFontSize * 2.1;
  const badgeGap = badgeFontSize * 0.6;
  let bx = pad;
  let by = h - scrimHeight + badgeH * 0.4;
  const maxRowWidth = w - pad * 2;
  for (const adv of shownAdvantages) {
    const textW = ctx.measureText(adv).width;
    const badgeW = textW + badgeFontSize * 1.8;
    if (bx + badgeW > pad + maxRowWidth && bx > pad) {
      bx = pad;
      by += badgeH + badgeGap * 0.6;
    }
    ctx.fillStyle = accentColor;
    const radius = badgeH / 2;
    ctx.beginPath();
    ctx.moveTo(bx + radius, by);
    ctx.arcTo(bx + badgeW, by, bx + badgeW, by + badgeH, radius);
    ctx.arcTo(bx + badgeW, by + badgeH, bx, by + badgeH, radius);
    ctx.arcTo(bx, by + badgeH, bx, by, radius);
    ctx.arcTo(bx, by, bx + badgeW, by, radius);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(adv, bx + badgeFontSize * 0.9, by + badgeH / 2);
    bx += badgeW + badgeGap;
  }

  // Product name — large, bold, bottom-anchored below the badges.
  const nameFontSize = Math.max(22, Math.round(w * 0.06));
  ctx.font = `800 ${nameFontSize}px 'Segoe UI', Arial, sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'alphabetic';
  const nameLines = wrapText(ctx, name, w - pad * 2).slice(0, 2);
  const lineHeight = nameFontSize * 1.15;
  let nameY = h - pad - (nameLines.length - 1) * lineHeight;
  for (const line of nameLines) {
    ctx.fillText(line, pad, nameY);
    nameY += lineHeight;
  }

  return canvas.toDataURL('image/png');
}
