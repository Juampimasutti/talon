/** Ventana de filas que realmente se pintan en una tabla virtualizada. */
export function visibleWindow(options: {
  scrollTop: number;
  viewport: number;
  rowHeight: number;
  count: number;
  overscan?: number;
}): { start: number; end: number; rendered: number } {
  const overscan = options.overscan ?? 6;
  const rowHeight = Math.max(1, options.rowHeight);
  const start = Math.max(0, Math.floor(options.scrollTop / rowHeight) - overscan);
  const visible = Math.ceil(options.viewport / rowHeight);
  const end = Math.min(options.count, start + visible + overscan * 2);
  return { start, end, rendered: Math.max(0, end - start) };
}
