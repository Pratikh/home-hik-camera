import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Phase 2 container-hardening regression tests (WRK-01 / WRK-02 / STR-03).
 *
 * These are static text assertions over compose.yml and the four Dockerfiles.
 * They deliberately do not need Podman: they pin the properties that are easy
 * to lose in a later edit (non-root USER, read-only rootfs, minimal per-service
 * environments, unchanged published ports, read-only model mount).
 *
 * Regexes are used instead of a YAML parser so the checks keep working across
 * formatting changes (key order, quoting, comments) without a new dependency.
 */
const ROOT = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

// Normalise line endings so the checks behave the same on a CRLF checkout.
const compose = read("compose.yml").replace(/\r\n?/g, "\n");
const composeLines = compose.split("\n");

/** Lines of one top-level service block, without the `  <service>:` line. */
function serviceBlock(name: string): string[] {
  const start = composeLines.findIndex((line) => line.trimEnd() === `  ${name}:`);
  if (start === -1) throw new Error(`compose.yml has no "${name}" service`);
  const block: string[] = [];
  for (const line of composeLines.slice(start + 1)) {
    // A service block ends at the next line indented two spaces or less
    // (the next service or a top-level key).
    if (line.trim() !== "" && !line.startsWith("    ")) break;
    block.push(line);
  }
  return block;
}

/** Inline value plus nested lines of a mapping key in a service block. */
function serviceSetting(name: string, key: string): string | null {
  const block = serviceBlock(name);
  const keyPattern = new RegExp(`^ {4}${key}:`);
  const keyIndex = block.findIndex((line) => keyPattern.test(line));
  if (keyIndex === -1) return null;
  const inline = block[keyIndex].replace(keyPattern, "").trim();
  const nested: string[] = [];
  for (const line of block.slice(keyIndex + 1)) {
    // Nested entries are indented six spaces or more; anything else starts the
    // next service-level key.
    if (line.trim() !== "" && !line.startsWith("      ")) break;
    nested.push(line);
  }
  return [inline, ...nested].join("\n");
}

/** Environment variable names passed by a service's `environment:` block. */
function environmentKeys(name: string): string[] {
  const environment = serviceSetting(name, "environment");
  if (environment === null) return [];
  const keys: string[] = [];
  for (const line of environment.split("\n")) {
    const mapping = /^\s*([A-Z][A-Z0-9_]*):/.exec(line);
    if (mapping) {
      keys.push(mapping[1]);
      continue;
    }
    // Also tolerate the list form (`- KEY=value`) so a formatting change does
    // not silently defeat the least-privilege checks.
    const list = /^\s*-\s*([A-Z][A-Z0-9_]*)=/.exec(line);
    if (list) keys.push(list[1]);
  }
  return keys;
}

/** Published port strings (`"host:container"`) of a service. */
function publishedPorts(name: string): string[] {
  const ports = serviceSetting(name, "ports");
  if (ports === null) return [];
  return [...ports.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/** The last `USER` instruction of a Dockerfile, or null. */
function lastUserDirective(dockerfile: string): string | null {
  const users = [...dockerfile.matchAll(/^USER\s+(.+?)\s*$/gm)].map((match) => match[1]);
  return users.length > 0 ? users[users.length - 1] : null;
}

const WORKERS = ["object-worker", "face-worker"] as const;
const MEDIAMTX_AND_WORKERS = ["mediamtx", ...WORKERS] as const;
const ALL_SERVICES = ["mediamtx", "web", ...WORKERS] as const;
const FORBIDDEN_FOR_MEDIAMTX_AND_WORKERS = [/^SESSION_SECRET$/, /^TELEGRAM_/, /^APP_/];

describe("compose.yml: per-service environments (WRK-02)", () => {
  it("does not give MediaMTX or either worker the shared .env file", () => {
    for (const name of MEDIAMTX_AND_WORKERS) {
      const block = serviceBlock(name).join("\n");
      expect(block, `${name} must not use env_file`).not.toMatch(/^\s*env_file\s*:/m);
    }
  });

  it("does not inject SESSION_SECRET, TELEGRAM_* or APP_* into MediaMTX or the workers", () => {
    for (const name of MEDIAMTX_AND_WORKERS) {
      const keys = environmentKeys(name);
      const leaked = keys.filter((key) => FORBIDDEN_FOR_MEDIAMTX_AND_WORKERS.some((pattern) => pattern.test(key)));
      expect(leaked, `${name} leaks application secrets: ${leaked.join(", ")}`).toEqual([]);
    }
  });

  it("does not inject DVR/HIKVISION credentials into the detection workers", () => {
    for (const name of WORKERS) {
      const leaked = environmentKeys(name).filter((key) => /^(DVR_|HIKVISION_)/.test(key));
      expect(leaked, `${name} must not receive DVR credentials: ${leaked.join(", ")}`).toEqual([]);
    }
  });

  it("gives the face worker no MediaMTX credential and the object worker no face-only settings", () => {
    expect(environmentKeys("face-worker")).not.toContain("MEDIAMTX_AUTH_PASSWORD");
    expect(environmentKeys("face-worker")).not.toContain("MEDIAMTX_AUTH_USER");
    expect(environmentKeys("object-worker")).not.toContain("FACE_DETECTION_ENABLED");
    expect(environmentKeys("object-worker")).not.toContain("FACE_DETECTION_CONFIDENCE");
  });

  it("keeps the web's application environment available (it needs the secrets)", () => {
    // Least privilege must not strip the hub of the credentials it genuinely
    // uses. The web may keep env_file (current) or enumerate them explicitly.
    const webBlock = serviceBlock("web").join("\n");
    const keys = environmentKeys("web");
    const hasEnvFile = /^ {4}env_file\s*:/m.test(webBlock);
    for (const key of ["SESSION_SECRET", "APP_PASSWORD", "DVR_PASSWORD", "TELEGRAM_BOT_TOKEN"]) {
      expect(hasEnvFile || keys.includes(key), `web must still receive ${key}`).toBe(true);
    }
  });

  it("keeps the minimum variables each service actually reads", () => {
    const mediamtx = environmentKeys("mediamtx");
    for (const key of [
      "DVR_HOST",
      "HIKVISION_IP",
      "DVR_RTSP_PORT",
      "DVR_USERNAME",
      "DVR_PASSWORD",
      "MEDIAMTX_AUTH_USER",
      "MEDIAMTX_AUTH_PASSWORD",
      "WEBRTC_ADDITIONAL_HOST",
    ]) {
      expect(mediamtx, `mediamtx needs ${key}`).toContain(key);
    }

    const objectWorker = environmentKeys("object-worker");
    for (const key of [
      "DATA_DIR",
      "OBJECT_DETECTION_MODEL_PATH",
      "MEDIAMTX_RTSP_URL",
      "OBJECT_DETECTION_STREAM",
      "MEDIAMTX_AUTH_USER",
      "MEDIAMTX_AUTH_PASSWORD",
      "OBJECT_DETECTION_HEARTBEAT_MS",
      "OBJECT_DETECTION_MAX_TRACKS_PER_CAMERA",
    ]) {
      expect(objectWorker, `object-worker needs ${key}`).toContain(key);
    }

    const faceWorker = environmentKeys("face-worker");
    for (const key of [
      "DATA_DIR",
      "FACE_DETECTION_ENABLED",
      "FACE_DETECTION_MODEL_PATH",
      "FACE_DETECTION_CONFIDENCE",
      "FACE_DETECTION_MAX_FACES",
      "FACE_DETECTION_BATCH_SIZE",
    ]) {
      expect(faceWorker, `face-worker needs ${key}`).toContain(key);
    }
  });
});

describe("compose.yml: container hardening (WRK-01 / STR-03)", () => {
  it("runs every service with a read-only root filesystem and a writable /tmp", () => {
    for (const name of ALL_SERVICES) {
      expect(serviceSetting(name, "read_only")?.toLowerCase(), `${name} must set read_only: true`).toContain("true");
      const tmpfs = serviceSetting(name, "tmpfs");
      expect(tmpfs, `${name} needs a tmpfs for /tmp`).toMatch(/(^|\n)\s*-\s*\/tmp(:|\s|$)/);
    }
  });

  it("drops all capabilities and blocks privilege escalation on every service", () => {
    for (const name of ALL_SERVICES) {
      const capDrop = serviceSetting(name, "cap_drop");
      expect(capDrop, `${name} must cap_drop ALL`).toMatch(/\bALL\b/);
      const securityOpt = serviceSetting(name, "security_opt");
      expect(securityOpt, `${name} must set no-new-privileges`).toMatch(/no-new-privileges:true/);
    }
  });

  it("bounds memory, PIDs and shutdown time on every service", () => {
    for (const name of ALL_SERVICES) {
      expect(serviceSetting(name, "mem_limit"), `${name} needs mem_limit`).toMatch(/\d+\s*[mg]/i);
      expect(serviceSetting(name, "pids_limit"), `${name} needs pids_limit`).toMatch(/\d+/);
      expect(serviceSetting(name, "stop_grace_period"), `${name} needs stop_grace_period`).toMatch(/\d+/);
    }
  });

  it("keeps a writable cache mount for the web image's read-only rootfs", () => {
    const tmpfs = serviceSetting("web", "tmpfs");
    expect(tmpfs).toMatch(/\/app\/\.next\/cache/);
  });
});

describe("compose.yml: published ports are still only 3000 and 8189", () => {
  it("publishes the hub on 3000 only", () => {
    expect(publishedPorts("web")).toEqual(["3000:3000"]);
  });

  it("publishes MediaMTX on the WebRTC media port 8189 tcp/udp only", () => {
    expect(publishedPorts("mediamtx")).toEqual(["8189:8189/tcp", "8189:8189/udp"]);
  });

  it("publishes no ports for either worker", () => {
    expect(publishedPorts("object-worker")).toEqual([]);
    expect(publishedPorts("face-worker")).toEqual([]);
  });
});

describe("compose.yml: object-worker model mount is read-only", () => {
  it("mounts ./object-worker/models read-only", () => {
    expect(serviceBlock("object-worker").join("\n")).toContain("./object-worker/models:/app/models:ro");
    // Comments mention the path too; only real volume entries must be :ro.
    const modelMounts = compose.split("\n").filter((line) => /^\s*-\s+\.\/object-worker\/models:/.test(line));
    expect(modelMounts).toHaveLength(1);
    for (const mount of modelMounts) expect(mount, "model mount must be :ro").toContain(":ro");
  });
});

describe("Dockerfiles: non-root execution (WRK-01)", () => {
  const dockerfiles = [
    ["web", "Dockerfile"],
    ["mediamtx", "mediamtx/Dockerfile"],
    ["object-worker", "object-worker/Dockerfile"],
    ["face-worker", "face-worker/Dockerfile"],
  ] as const;

  it("runs every image as uid/gid 10001 (cctv)", () => {
    for (const [name, file] of dockerfiles) {
      const dockerfile = read(file);
      expect(dockerfile, `${name}: ${file} has no USER directive`).toMatch(/^USER\s+/m);
      expect(lastUserDirective(dockerfile), `${name}: ${file} must not run as root`).not.toBe("root");
      expect(lastUserDirective(dockerfile), `${name}: ${file} final USER must be 10001 or cctv`).toMatch(
        /^(?:10001(?::10001)?|cctv(?::cctv)?)$/,
      );
      expect(dockerfile, `${name}: ${file} must create uid 10001`).toMatch(/(?:useradd|adduser)[^\n]*10001/);
      expect(dockerfile, `${name}: ${file} must create gid 10001`).toMatch(/(?:groupadd|addgroup)[^\n]*10001/);
    }
  });

  it("keeps the web standalone build, server.js, ffmpeg and wget", () => {
    const dockerfile = read("Dockerfile");
    expect(dockerfile).toContain("/app/.next/standalone");
    expect(dockerfile).toMatch(/CMD\s+\[\s*"node",\s*"server\.js"\s*\]/);
    expect(dockerfile).toMatch(/apk add[^\n]*ffmpeg/);
    expect(dockerfile).toMatch(/apk add[^\n]*wget/);
  });
});

describe("object-worker entrypoint: verify the host-provisioned model, never download", () => {
  const entrypoint = read("object-worker/docker-entrypoint.sh");

  it("fails with an actionable host-provisioning message when the model is missing", () => {
    expect(entrypoint).toMatch(/if \[ ! -f "\$MODEL_PATH" \]/);
    expect(entrypoint).toContain("npm run object:model");
    expect(entrypoint).toMatch(/exit 1/);
  });

  it("never downloads at container start", () => {
    // The old behaviour ran download_model.py (and a --force retry, then a
    // warning) before starting the worker. The only remaining invocation must
    // be the checksum verification after the file-exists guard.
    const guardIndex = entrypoint.search(/if \[ ! -f/);
    const verifierIndex = entrypoint.search(/\/app\/scripts\/download_model\.py/);
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(verifierIndex).toBeGreaterThan(guardIndex);
    expect(entrypoint.match(/\/app\/scripts\/download_model\.py/g)).toHaveLength(1);
    expect(entrypoint).not.toMatch(/\|\|\s*python3 \/app\/scripts\/download_model\.py/);
  });

  it("keeps starting the worker after successful verification", () => {
    expect(entrypoint).toMatch(/exec "\$@"/);
  });
});
