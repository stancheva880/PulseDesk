// Square-crops and downscales a picked file client-side before it ever reaches the network —
// there is no object storage in this stack (backend/prisma/schema.prisma), so the result lands
// in a DB column capped at 300,000 chars (UpdateOwnProfileDto). JPEG, not WEBP: toDataURL's WEBP
// support is inconsistent across browsers, JPEG is universal.
const AVATAR_SIZE = 256;
const JPEG_QUALITY = 0.85;
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

export class AvatarImageError extends Error {}

export async function compressAvatarFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new AvatarImageError('not-an-image');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new AvatarImageError('too-large');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_SIZE;
    canvas.height = AVATAR_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new AvatarImageError('canvas-unavailable');

    // Cover-crop: scale so the shorter side fills AVATAR_SIZE, center the longer side.
    const scale = AVATAR_SIZE / Math.min(img.naturalWidth, img.naturalHeight);
    const drawWidth = img.naturalWidth * scale;
    const drawHeight = img.naturalHeight * scale;
    ctx.drawImage(
      img,
      (AVATAR_SIZE - drawWidth) / 2,
      (AVATAR_SIZE - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );

    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new AvatarImageError('decode-failed'));
    img.src = src;
  });
}
