/**
 * lib/compress.ts — Client-side file compression & validation
 *
 * Image compression: Canvas-based JPEG re-encode. Shrinks large images to
 * ≤ MAX_IMAGE_BYTES while keeping text in documents readable.
 *
 * PDF guard: PDFs are not re-encodable in the browser; we enforce a hard size
 * limit and show a clear error if exceeded.
 *
 * Future hook for Make webhooks: call triggerMakeWebhook() after a successful
 * upload. Currently a no-op; replace with a real fetch() call when ready.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Max image size after compression (bytes). ~1 MB */
export const MAX_IMAGE_BYTES = 1 * 1024 * 1024;

/** Max PDF / document size (bytes). 15 MB */
export const MAX_PDF_BYTES = 15 * 1024 * 1024;

/** JPEG quality for compressed output (0–1). 0.82 keeps text sharp in docs. */
const JPEG_QUALITY = 0.82;

/** Max pixel dimension (width or height). Prevents absurdly large canvases. */
const MAX_DIMENSION = 3000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FileValidationResult {
  ok: boolean;
  error?: string;
}

// ─── PDF / document guard ─────────────────────────────────────────────────────

/**
 * Validates a PDF or other document file against the size limit.
 * Returns { ok: true } if acceptable, { ok: false, error: "..." } if not.
 */
export function validateDocumentFile(file: File): FileValidationResult {
  if (file.size > MAX_PDF_BYTES) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `File is too large (${sizeMB} MB). Please compress the PDF to under 15 MB before uploading.`,
    };
  }
  return { ok: true };
}

// ─── Image compression ────────────────────────────────────────────────────────

/**
 * Compresses an image File to ≤ MAX_IMAGE_BYTES using the browser Canvas API.
 *
 * - If the image is already small enough, returns the original File unchanged.
 * - Scales down proportionally if either dimension exceeds MAX_DIMENSION.
 * - Re-encodes as JPEG at JPEG_QUALITY.
 * - Returns a new File with the same name but .jpg extension.
 */
export async function compressImage(file: File): Promise<File> {
  // Already small enough — skip compression
  if (file.size <= MAX_IMAGE_BYTES) return file;

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;

      // Scale down if needed
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas context not available"));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Canvas toBlob returned null"));
            return;
          }

          // Build a new File with the same base name but .jpg extension
          const baseName = file.name.replace(/\.[^.]+$/, "");
          const compressedFile = new File([blob], `${baseName}.jpg`, {
            type: "image/jpeg",
            lastModified: Date.now(),
          });

          resolve(compressedFile);
        },
        "image/jpeg",
        JPEG_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to load image: ${file.name}`));
    };

    img.src = objectUrl;
  });
}

// ─── Smart file processor ─────────────────────────────────────────────────────

/**
 * Routes a file through the correct handler:
 * - Images → compress
 * - PDFs / documents → size-validate only
 *
 * Returns { file, error } where:
 * - file  = the (possibly compressed) File ready for upload
 * - error = human-readable error string if the file should be rejected
 */
export async function processFileForUpload(
  file: File
): Promise<{ file: File | null; error: string | null }> {
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";
  const isDocument = !isImage; // PDFs, Word docs, Excel, etc.

  if (isImage) {
    try {
      const compressed = await compressImage(file);
      return { file: compressed, error: null };
    } catch (e) {
      return { file: null, error: `Could not compress image: ${(e as Error).message}` };
    }
  }

  if (isDocument || isPdf) {
    const validation = validateDocumentFile(file);
    if (!validation.ok) {
      return { file: null, error: validation.error! };
    }
    return { file, error: null };
  }

  return { file, error: null };
}

// ─── Make webhook stub ────────────────────────────────────────────────────────

/**
 * Called after a successful document upload.
 * Currently a no-op — wire this to a Make.com webhook URL when ready.
 *
 * Example Make trigger payload:
 * {
 *   containerId, documentType, storagePath, fileName, uploadedBy, uploadedAt
 * }
 */
export async function triggerMakeWebhook(payload: Record<string, unknown>): Promise<void> {
  const webhookUrl = process.env.NEXT_PUBLIC_MAKE_WEBHOOK_URL;
  if (!webhookUrl) return; // not configured yet — skip silently

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // Webhook failures are non-fatal — log but don't break the upload flow
    console.warn("[Make webhook] Failed to trigger:", e);
  }
}
