// Saves a file the app shows (a generation, an export) to the device, in the web build and the
// demo. Safari (iPad above all) lets a page start a download only while it is still handling the
// tap: after any wait — fetching the file, reading it — the download is silently dropped, which is
// how "Скачать" used to do nothing. So the two usual cases start the download at once:
// - a picture held in the page (data:, as the image models return it) is decoded on the spot and
//   saved through a short blob: link;
// - a file in our storage is fetched by the browser itself from a link that asks the server to send
//   it as an attachment, so the page stays where it is.
// Anything else (a provider's link, a blob: link) is fetched first and then saved; a link this page
// may not read (another site without CORS) opens in a new tab, where it can be saved by hand. A link
// that no longer works is an error for the caller to show.

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
};

export const DOWNLOAD_FAILED = 'download-failed';

// "image-1.png" holding a JPEG is saved as "image-1.jpg"; a name of another kind (.json, .docx…)
// is left as it is.
function withExtension(name: string, ext: string | undefined): string {
  if (!ext || !/\.(png|jpe?g|webp|mp4)$/i.test(name)) return name;
  return name.replace(/\.[a-z0-9]+$/i, `.${ext}`);
}

function clickLink(href: string, name: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function saveBlob(blob: Blob, suggestedName: string): string {
  const name = withExtension(suggestedName, EXTENSIONS[blob.type]);
  const href = URL.createObjectURL(blob);
  clickLink(href, name);
  // the browser reads the blob when the download starts; a minute is plenty, even for a video
  window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
  return name;
}

function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(',');
  if (comma < 0) throw new Error(DOWNLOAD_FAILED);
  const head = url.slice(5, comma);
  const mime = head.split(';')[0] || 'application/octet-stream';
  const body = url.slice(comma + 1);
  if (!/;base64$/i.test(head)) return new Blob([decodeURIComponent(body)], { type: mime });
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// A Supabase Storage link (/storage/v1/object/public|sign/…) with ?download=, which makes the
// server answer with Content-Disposition: attachment. null for any other link. A signed link past
// its expiry would open the server's error instead of saving, so that is an error here.
function storageAttachmentUrl(url: string, suggestedName: string): { href: string; name: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const kind = /^\/storage\/v1\/object\/(public|sign)\//.exec(u.pathname)?.[1];
  if (u.protocol !== 'https:' || !kind) return null;
  if (kind === 'sign') {
    const exp = tokenExpiry(u.searchParams.get('token'));
    if (exp !== null && exp * 1000 < Date.now() + 5_000) throw new Error(DOWNLOAD_FAILED);
  }
  const name = withExtension(suggestedName, /\.([a-z0-9]+)$/i.exec(u.pathname)?.[1]?.toLowerCase().replace('jpeg', 'jpg'));
  u.searchParams.set('download', name);
  return { href: u.toString(), name };
}

function tokenExpiry(token: string | null): number | null {
  try {
    const part = (token ?? '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const exp = (JSON.parse(atob(part + '='.repeat(-part.length & 3))) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

export async function downloadFile(url: string, suggestedName: string): Promise<string> {
  // started before the first await, while the tap still counts (see the note at the top)
  if (url.startsWith('data:')) return saveBlob(dataUrlToBlob(url), suggestedName);
  const stored = storageAttachmentUrl(url, suggestedName);
  if (stored) {
    clickLink(stored.href, stored.name);
    return stored.name;
  }

  let blob: Blob;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(DOWNLOAD_FAILED);
    blob = await res.blob();
  } catch (err) {
    if (url.startsWith('blob:') || (err instanceof Error && err.message === DOWNLOAD_FAILED)) throw new Error(DOWNLOAD_FAILED);
    const tab = window.open(url, '_blank');
    if (!tab) throw new Error(DOWNLOAD_FAILED);
    tab.opener = null;
    return suggestedName;
  }
  return saveBlob(blob, suggestedName);
}
