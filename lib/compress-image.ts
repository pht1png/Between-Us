const HEIC_TYPES = new Set(["image/heic", "image/heif"]);

// iOS/Safari (all iOS browsers, since they all run on WebKit) can decode HEIC directly via
// createImageBitmap. Chrome, Firefox, and Edge — including Android Chrome and desktop browsers
// opening a photo AirDropped from an iPhone — have no HEIC codec and throw. Detecting by
// extension too because some browsers report an empty `file.type` for HEIC picked via a file
// input.
function isHeic(file: File): boolean {
  return HEIC_TYPES.has(file.type) || /\.hei[cf]$/i.test(file.name);
}

async function toDecodableBlob(file: File): Promise<Blob> {
  if (!isHeic(file)) return file;
  const heic2any = (await import("heic2any")).default;
  const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.8 });
  return Array.isArray(converted) ? converted[0] : converted;
}

export async function compressImageToDataUrl(
  file: File,
  { maxSize = 240, quality = 0.6 }: { maxSize?: number; quality?: number } = {},
): Promise<string> {
  const decodable = await toDecodableBlob(file);
  const bitmap = await createImageBitmap(decodable);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", quality);
}
