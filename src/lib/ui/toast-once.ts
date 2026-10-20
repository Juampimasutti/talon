export function acceptToast(
  message: string,
  now: number,
  previous: { message: string; at: number } | null,
  windowMs = 1500,
): { accept: boolean; next: { message: string; at: number } } {
  if (previous && previous.message === message && now - previous.at < windowMs) {
    return { accept: false, next: previous };
  }
  return { accept: true, next: { message, at: now } };
}
