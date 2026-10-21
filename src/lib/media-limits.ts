/** Upload limits shared by the browser uploader, the server and the DB CHECK constraint. */
export const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
/** Vercel caps a function request body at 4.5 MB, so uploads are sent in chunks of this size. */
export const UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type UploadContentType = (typeof IMAGE_TYPES)[number] | (typeof DOCUMENT_TYPES)[number];
export const IMAGE_ACCEPT = ".jpg,.jpeg,.png,.webp";
export const DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png";
