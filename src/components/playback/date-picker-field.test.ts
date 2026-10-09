import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DatePickerField } from "@/components/playback/DatePickerField";

/**
 * The Date field must be a normal input that expands a popover on demand, not a
 * permanent calendar column. The closed state is what guarantees the playback
 * layout is unaffected, so it is asserted directly from the rendered markup.
 */

function render(props?: Partial<Parameters<typeof DatePickerField>[0]>) {
  return renderToStaticMarkup(
    createElement(DatePickerField, {
      date: "2026-10-09",
      month: "2026-10",
      recorded: ["2026-10-01", "2026-10-09"],
      status: "ready" as const,
      error: null,
      onMonthChange: () => undefined,
      onSelect: () => undefined,
      onReload: () => undefined,
      ...props,
    }),
  );
}

describe("date picker field - closed state", () => {
  it("shows the selected date in YYYY-MM-DD", () => {
    const html = render();
    expect(html).toContain("2026-10-09");
  });

  it("renders no calendar while closed, so it takes no layout space", () => {
    const html = render();
    expect(html).not.toContain("rdp-app");
    expect(html).not.toContain("rdp-month");
  });

  it("reports itself collapsed to assistive technology", () => {
    const html = render();
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it("is a real button, so it is reachable and operable by keyboard", () => {
    const html = render();
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
  });

  it("does not use a native date input", () => {
    const html = render();
    expect(html).not.toContain('type="date"');
  });

  it("labels the field for screen readers", () => {
    expect(render()).toContain("Date");
  });
});

describe("date picker field - trigger", () => {
  it("keeps the value in an element the styling can target", () => {
    const html = render({ date: "2027-01-31" });
    expect(html).toContain("2027-01-31");
  });

  it("still renders when availability failed, so the field is never blank", () => {
    const html = render({ status: "error" as const, error: "DVR offline", recorded: [] });
    expect(html).toContain("2026-10-09");
  });
});
