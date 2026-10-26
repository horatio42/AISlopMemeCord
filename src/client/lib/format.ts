export function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export function fmtRelative(ts: number, now = Date.now()): string {
  const diff = now - ts;
  if (diff < 0) return fmtDateTime(ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(ts);
}
export function fmtFullRelative(ts: number): string {
  return `${fmtDateTime(ts)} (${fmtRelative(ts)})`;
}
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function fmtDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}
export function initial(name: string): string {
  return (name || '?').trim().charAt(0).toUpperCase();
}
const AVATAR_COLORS = ['#b8ff35', '#5ee7ff', '#ff7ac8', '#b58cff', '#ffa64d', '#57d98a', '#ffd93d', '#8b9dff'];
export function colorFor(id: string, name = ''): string {
  let h = 0;
  for (const c of (id || name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}
export function roleColor(color: string | null | undefined): string | undefined {
  return color && color !== '#000000' && color !== 'transparent' ? color : undefined;
}
export function sameDay(a: number, b: number): boolean {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}
export function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  if (sameDay(ts, today.getTime())) return 'Today';
  if (sameDay(ts, yesterday.getTime())) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}
export function isEmojiOnly(text: string): boolean {
  const trimmed = text.replace(/<a?:([\w-]+):([\w-]+)>/g, ' ').trim();
  if (!trimmed) return false;
  const stripped = trimmed.replace(/\s/g, '');
  const emojiRegex = /^[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f]+$/u;
  return emojiRegex.test(stripped);
}
export function plural(n: number, word: string, pluralWord?: string): string {
  return `${n} ${n === 1 ? word : pluralWord ?? word + 's'}`;
}
