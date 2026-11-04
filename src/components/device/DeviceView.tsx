"use client";

import type { DvrInfoResponse } from "@/lib/api-types";
import { Messages } from "@/lib/messages";
import { usePoll } from "@/components/hooks/usePoll";
import { ErrorBanner } from "@/components/ui/States";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusLamp } from "@/components/ui/StatusLamp";
import { formatKolkataDateTimeFromIso } from "@/lib/time-kolkata";

function display(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return Messages.notReported;
  return String(value);
}

/**
 * DVR identity.
 *
 * Read-only: whatever the DVR reports over the local network, with an explicit
 * "Not reported" for fields it does not answer. The poll interval and the
 * `/api/dvr/info` contract are unchanged.
 */
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
        ["Device time", data.device.currentDeviceTime ? formatKolkataDateTimeFromIso(data.device.currentDeviceTime) : Messages.notReported],
      ]
    : [];

  return (
    <div className="min-w-0" style={{ maxWidth: 1000, margin: "0 auto" }}>
      <PageHeader
        eyebrow="System"
        title="Device"
        detail="Information read from the DVR over the local network."
      />

      {loading && !data ? <p className="section__hint">{Messages.checking}</p> : null}
      {error && !data ? <ErrorBanner message={error} onRetry={() => void reload()} /> : null}

      {data ? (
        <>
          <section className="card" aria-label="DVR status">
            <div
              className="card__body"
              style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 24px", padding: "12px 16px" }}
            >
              <StatusLamp tone={tone} label={data.message} />
              <span className="section__hint" style={{ marginLeft: "auto" }}>
                Read over the local network · no DVR credential is shown
              </span>
            </div>
          </section>

          <section className="section">
            {rows.length > 0 ? (
              <dl className="kv-grid">
                {rows.map(([label, value]) => (
                  <div key={label} className="kv">
                    <dt>{label}</dt>
                    <dd className={value === Messages.notReported ? undefined : "mono"}>{value}</dd>
                  </div>
                ))}
                {rows.length % 2 === 1 ? <div className="kv" aria-hidden="true" /> : null}
              </dl>
            ) : (
              <p className="section__hint">{data.message}</p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
