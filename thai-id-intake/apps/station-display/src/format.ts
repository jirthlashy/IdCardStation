export function secondsUntil(value?: string) {
  if (!value) return "";
  const seconds = Math.max(0, Math.ceil((Date.parse(value) - Date.now()) / 1000));
  return `${seconds}s`;
}

export function secondsSince(value?: string) {
  if (!value) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  return `${seconds}s`;
}
