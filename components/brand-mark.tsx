export function BrandMark({ inverse = false, size = 36 }: { inverse?: boolean; size?: number }) {
  const foreground = inverse ? '#ffffff' : '#152b4a';
  const accent = inverse ? '#7dd3fc' : '#38bdf8';
  return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-label="Northstar" role="img"><rect width="40" height="40" rx="12" fill={foreground}/><path d="M20 7.5 23.4 16.6 32.5 20l-9.1 3.4L20 32.5l-3.4-9.1L7.5 20l9.1-3.4L20 7.5Z" fill={accent}/><path d="m20 12.7 2 5.3 5.3 2-5.3 2-2 5.3-2-5.3-5.3-2 5.3-2 2-5.3Z" fill="#fff"/></svg>;
}
