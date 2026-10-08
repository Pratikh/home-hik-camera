export function safeNext(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  if (value.startsWith("/login")) return "/";
  if (value.includes("\\") || value.includes("\n") || value.includes("\r") || value.includes("://")) return "/";
  return value;
}
