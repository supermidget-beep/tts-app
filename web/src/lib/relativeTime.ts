export function relativeTime(timestampMs: number): string {
  const diffSeconds = Math.round((Date.now() - timestampMs) / 1000);
  if (diffSeconds < 60) return "just now";
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.round(diffDays / 7);
  if (diffDays < 30) return `${diffWeeks}w ago`;
  const diffMonths = Math.round(diffDays / 30);
  if (diffDays < 365) return `${diffMonths}mo ago`;
  const diffYears = Math.round(diffDays / 365);
  return `${diffYears}y ago`;
}
