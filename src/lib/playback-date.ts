export function resolvePlaybackDate(input: {
  today: string;
  selected: string | null;
  userChoseDate: boolean;
}): string {
  if (input.userChoseDate && input.selected) return input.selected;
  return input.today;
}

export function recordingToAutoplay<T extends { startTime: string }>(recordings: readonly T[]): T | null {
  let latest: T | null = null;
  for (const recording of recordings) {
    if (!latest || recording.startTime > latest.startTime) latest = recording;
  }
  return latest;
}
