export { fmtDate, fmtDateTime, fmtFullRelative, fmtRelative, fmtSize, fmtTime, fmtDuration, dayLabel, sameDay } from './format';
export function fmtSince(ts: number): string {
  const days = Math.max(0, Math.floor((Date.now() - ts) / 86400000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days`;
  if (days < 365) return `${Math.floor(days / 30)} months`;
  return `${Math.floor(days / 365)} years`;
}
