import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlaybackCalendar } from "@/components/playback/PlaybackCalendar";
import { todayInKolkata } from "@/lib/time-kolkata";

/**
 * The playback calendar, rendered to static markup.
 *
 * React DayPicker puts real `disabled` attributes on day buttons, so the rendered
 * HTML is enough to prove which dates a user can actually pick — no browser
 * needed. These tests pin that behaviour, because a wrong `disabled` matcher is
 * invisible to TypeScript and silently locks the user out of every date.
 */

function render(props: {
  month: string;
  selected?: string | null;
  recorded: string[];
  loading?: boolean;
}) {
  return renderToStaticMarkup(
    createElement(PlaybackCalendar, {
      month: props.month,
      selected: props.selected ?? null,
      recorded: props.recorded,
      loading: props.loading ?? false,
      onMonthChange: () => undefined,
      onSelect: () => undefined,
    }),
  );
}

/** Day buttons, paired with whether they carry the real disabled attribute. */
function dayButtons(html: string): Array<{ label: string; disabled: boolean }> {
  const out: Array<{ label: string; disabled: boolean }> = [];
  const re = /<button([^>]*)>/g;
  for (const match of html.matchAll(re)) {
    const attrs = match[1] ?? "";
    const label = /aria-label="([^"]*)"/.exec(attrs)?.[1];
    if (!label || !/\d{4}/.test(label)) continue;
    // Match the attribute itself, not the "disabled:" CSS variant prefix.
    out.push({ label, disabled: /(^|\s)disabled(=|"|\s|$)/.test(attrs.replace(/class="[^"]*"/g, "")) });
  }
  return out;
}

const TODAY = todayInKolkata();
const MONTH = TODAY.slice(0, 7);
/** Two dates in the month under test that are not in the future. */
const PAST_DATES = ["01", "02"].map((d) => `${MONTH}-${d}`).filter((d) => d <= TODAY);

describe("playback calendar - date availability", () => {
  it("enables a date that has a recording", () => {
    if (PAST_DATES.length === 0) return;
    const target = PAST_DATES[0]!;
    const buttons = dayButtons(render({ month: MONTH, recorded: [target], selected: target }));
    const day = Number(target.slice(8));
    const button = buttons.find((item) => item.label.startsWith(`${day} `));
    expect(button, `expected a button for ${target}`).toBeDefined();
    expect(button?.disabled).toBe(false);
  });

  it("disables a date with no recording", () => {
    if (PAST_DATES.length === 0) return;
    const recorded = PAST_DATES[0]!;
    const missingDay = PAST_DATES.length > 1 && PAST_DATES[1] !== recorded ? PAST_DATES[1]! : null;
    // Pick an early day that is deliberately absent from `recorded`.
    const absent = [...Array(9)].map((_, i) => `${MONTH}-0${i + 1}`).find((d) => d <= TODAY && d !== recorded);
    if (!absent) return;
    const buttons = dayButtons(render({ month: MONTH, recorded: [recorded] }));
    const day = Number(absent.slice(8));
    const matches = buttons.filter((item) => item.label.startsWith(`${day} `));
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.disabled).toBe(true);
    void missingDay;
  });

  it("disables every future date in the month", () => {
    const html = render({ month: MONTH, recorded: [] });
    const future = dayButtons(html).filter((item) => {
      const match = /^(\d+) (\w+) (\d{4})/.exec(item.label);
      if (!match) return false;
      const day = Number(match[1]);
      const value = `${MONTH}-${String(day).padStart(2, "0")}`;
      return value > TODAY;
    });
    expect(future.length).toBeGreaterThan(0);
    expect(future.every((item) => item.disabled)).toBe(true);
  });

  it("marks a recorded date with the recorded modifier", () => {
    if (PAST_DATES.length === 0) return;
    const html = render({ month: MONTH, recorded: [PAST_DATES[0]!] });
    expect(html).toContain("rdp-recorded");
  });

  it("marks the selected date as selected", () => {
    if (PAST_DATES.length === 0) return;
    const html = render({ month: MONTH, recorded: PAST_DATES, selected: PAST_DATES[0]! });
    expect(html).toContain("rdp-selected");
  });

  it("keeps the library disabled class so the styling still applies", () => {
    const html = render({ month: MONTH, recorded: [] });
    expect(html).toContain("rdp-disabled");
  });
});

describe("playback calendar - accessibility", () => {
  it("names a recorded date and its availability", () => {
    if (PAST_DATES.length === 0) return;
    const day = Number(PAST_DATES[0]!.slice(8));
    const html = render({ month: MONTH, recorded: [PAST_DATES[0]!] });
    expect(html).toContain(`— recording available`);
    expect(html).toContain(`aria-label="${day} `);
  });

  it("names an unavailable date as having no recording", () => {
    const html = render({ month: MONTH, recorded: [] });
    expect(html).toContain("— no recording");
  });

  it("labels the month navigation buttons", () => {
    const html = render({ month: MONTH, recorded: [] });
    expect(html).toContain('aria-label="Previous month"');
    expect(html).toContain('aria-label="Next month"');
  });
});

describe("playback calendar - states", () => {
  it("shows a loading indicator while availability is fetched", () => {
    const html = render({ month: MONTH, recorded: [], loading: true });
    expect(html).toContain("Checking recordings...");
  });

  it("omits the loading indicator once availability has loaded", () => {
    const html = render({ month: MONTH, recorded: [], loading: false });
    expect(html).not.toContain("Checking recordings...");
  });

  it("always shows the legend so availability is not colour-only", () => {
    const html = render({ month: MONTH, recorded: [] });
    expect(html).toContain("Recording available");
    expect(html).toContain("No recording");
  });
});
