import { PlaybackView } from "@/components/playback/PlaybackView";
import { isCalendarDate, parseClock, todayInKolkata } from "@/lib/time-kolkata";

export const dynamic = "force-dynamic";

export default async function PlaybackPage({
  searchParams,
}: {
  searchParams: Promise<{ camera?: string; date?: string; time?: string }>;
}) {
  const params = await searchParams;
  const date = params.date && isCalendarDate(params.date) ? params.date : todayInKolkata();
  const camera = params.camera && /^[1-4]$/.test(params.camera) ? Number(params.camera) : 1;
  const clock = params.time ? parseClock(params.time.length === 5 ? params.time : params.time.slice(0, 5)) : null;
  const eventTime = clock ? (params.time && params.time.length >= 8 ? params.time.slice(0, 8) : `${clock}:00`) : null;
  return <PlaybackView initialDate={date} initialCamera={camera} eventTime={eventTime} />;
}
