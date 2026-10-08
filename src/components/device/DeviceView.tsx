"use client";

import type { DvrInfoResponse } from "@/lib/api-types";
import { Messages } from "@/lib/messages";
import { usePoll } from "@/components/hooks/usePoll";
import { ErrorBanner, PageIntro } from "@/components/ui/States";
import { StatusLamp } from "@/components/ui/StatusLamp";

function display(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return Messages.notReported;
  return String(value);
}

export function DeviceView() {
  const { data, error, loading, reload } = usePoll<DvrInfoResponse>("/api/dvr/info");
  const tone = data?.dvr === "connected" ? "online" : data?.dvr === "disconnected" ? "offline" : "warn";

  const rows = data?.device
    ? [
        ["Device name", display(data.device.name)],
        ["Model", display(data.device.model)],
        ["Serial", display(data.device.serialNumber)],
        ["Firmware", display(data.device.firmware)],
        ["Encoding version", display(data.device.encodingVersion)],
        ["Hardware version", display(data.device.hardwareVersion)],
        ["Web version", display(data.device.webVersion)],
        ["Plugin version", display(data.device.pluginVersion)],
        ["Channels", display(data.device.channelCount)],
        ["HDDs", display(data.device.hddCount)],
        ["Device time", display(data.device.currentDeviceTime)],
      ]
    : [];

  return (
    <section>
      <PageIntro title="Device" detail="Information read from the DVR over the local network." />
      {loading && !data ? <p className="text-sm text-muted">{Messages.checking}</p> : null}
      {error && !data ? <ErrorBanner message={error} onRetry={() => void reload()} /> : null}
      {data ? (
        <>
          <div className="mb-4 rounded-xl border border-line bg-card px-4 py-3">
            <StatusLamp tone={tone} label={data.message} />
          </div>
          {rows.length > 0 ? (
            <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
              {rows.map(([label, value], index) => (
                <div
                  key={label}
                  className={`min-w-0 bg-card px-4 py-3 ${index === rows.length - 1 && rows.length % 2 === 1 ? "sm:col-span-2" : ""}`}
                >
                  <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
                  <dd className="mt-1 break-words text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-muted">{data.message}</p>
          )}
        </>
      ) : null}
    </section>
  );
}
