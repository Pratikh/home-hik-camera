/**
 * Remove credentials from a MediaMTX log line before it reaches the container log.
 *
 * MediaMTX is configured with RTSP source URLs that contain the DVR username and
 * password (the only way to pull from the DVR). If MediaMTX ever prints a
 * source URL in a warning, the credential would otherwise be persisted in the
 * container log and `podman logs`. The wrapper around the binary pipes every
 * line through this function.
 */

/** scheme://user:password@host -> scheme://[redacted]@host */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)([^/\s@]+)@/gi;

/** Authorization: Basic <base64> / Bearer <token> */
const AUTHORIZATION = /\b(Authorization:\s*)(Basic|Bearer)\s+\S+/gi;

/** pass: "..." (rendered YAML accidentally echoed in a log) */
const YAML_PASSWORD = /\b(pass:\s*)("[^"]*"|'[^']*'|\S+)/gi;

export function redactLogLine(line) {
  return String(line ?? "")
    .replace(URL_USERINFO, (_match, scheme) => `${scheme}[redacted]@`)
    .replace(AUTHORIZATION, (_match, prefix, kind) => `${prefix}${kind} [redacted]`)
    .replace(YAML_PASSWORD, (_match, prefix) => `${prefix}[redacted]`);
}
