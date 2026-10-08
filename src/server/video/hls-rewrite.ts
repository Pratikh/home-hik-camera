export function rewriteHlsPlaylist(body: string, streamPath: string): string {
  const proxyBase = `/api/hls/${streamPath}/`;
  const mapUri = (uri: string): string => {
    const clean = uri.trim();
    if (!clean || clean.startsWith("data:")) return clean;
    let pathAndQuery = clean;
    if (clean.startsWith("http://") || clean.startsWith("https://")) {
      try {
        const url = new URL(clean);
        pathAndQuery = `${url.pathname}${url.search}`;
      } catch {
        return proxyBase;
      }
    }
    const marker = `/${streamPath}/`;
    const index = pathAndQuery.indexOf(marker);
    const rest = (index >= 0 ? pathAndQuery.slice(index + marker.length) : pathAndQuery.replace(/^\/+/, "")).replace(
      /^\/+/,
      "",
    );
    if (!rest || rest.includes("..") || rest.includes("://") || rest.includes("\\")) return proxyBase;
    return `${proxyBase}${rest}`;
  };

  return body
    .split(/\r?\n/)
    .map((line) => {
      if (line.startsWith("#")) {
        return line.replace(/URI="([^"]*)"/g, (_match, uri: string) => `URI="${mapUri(uri)}"`);
      }
      if (!line.trim()) return line;
      return mapUri(line);
    })
    .join("\n");
}
