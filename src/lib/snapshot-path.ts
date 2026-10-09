import path from "node:path";

/**
 * Resolve a stored snapshot path to an absolute file inside DATA_DIR/events.
 * Returns null for absolute paths, traversal, or anything that escapes the
 * events directory. Snapshots are never served from a public folder.
 */
export function snapshotFile(dataDir: string, stored: string | null): string | null {
  if (!stored) return null;
  if (stored.includes("..") || path.isAbsolute(stored)) return null;
  const root = path.resolve(dataDir, "events");
  const target = path.resolve(root, stored);
  if (!target.startsWith(`${root}${path.sep}`)) return null;
  return target;
}