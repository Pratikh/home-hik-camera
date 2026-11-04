#!/usr/bin/env node
/**
 * Run MediaMTX with credential-redacted logs.
 *
 * The container entrypoint execs this wrapper instead of the binary directly:
 * MediaMTX's stdout/stderr are piped line by line through `redactLogLine`, so an
 * RTSP source URL (which embeds the DVR credentials) can never end up in the
 * container log. Signals are forwarded and the wrapper exits with the child's
 * status, keeping normal container lifecycle behaviour.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { redactLogLine } from "./mediamtx-log-redact.mjs";

const [binary, ...args] = process.argv.slice(2);
if (!binary) {
  console.error("[mediamtx] usage: run-mediamtx.mjs <binary> [args...]");
  process.exit(2);
}

const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });

function forward(stream, target) {
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  lines.on("line", (line) => {
    target.write(`${redactLogLine(line)}\n`);
  });
}

forward(child.stdout, process.stdout);
forward(child.stderr, process.stderr);

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error(`[mediamtx] failed to start: ${error?.code ?? "error"}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
