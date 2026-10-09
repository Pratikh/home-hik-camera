import path from "node:path";

/**
 * Resolve a stored face-crop path to an absolute file inside
 * DATA_DIR/face-crops.
 *
 * Face crops are private CCTV data. The same rule as event snapshots applies:
 * the browser never supplies a path, only a face id, and the id is looked up in
 * the database. Even so, the stored value is treated as hostile — absolute
 * paths, Windows drive letters, `..` segments and anything that resolves outside
 * the crop directory are rejected.
 */
export function faceCropsDir(dataDir: string): string {
  return path.resolve(dataDir, "face-crops");
}

export function faceCropFile(dataDir: string, stored: string | null | undefined): string | null {
  if (!stored) return null;
  const normalized = stored.replaceAll("\\", "/").trim();
  if (!normalized) return null;
  if (normalized.includes("..")) return null;
  if (path.isAbsolute(normalized) || normalized.startsWith("/")) return null;
  if (/^[a-zA-Z]:/.test(normalized)) return null;
  if (normalized.includes("\u0000")) return null;

  const root = faceCropsDir(dataDir);
  const target = path.resolve(root, normalized);
  if (target === root) return null;
  if (!target.startsWith(`${root}${path.sep}`)) return null;
  return target;
}
