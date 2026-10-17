/* Football Dynasty 1.24b — read-only browser performance probe.
 * Paste this script into DevTools on a disposable test career.
 * Does not read, print, export or modify save contents.
 * Run FDPerf.start(), perform gameplay, then FDPerf.report().
 */
(() => {
  if (globalThis.FDPerf) return;
  const samples = [];
  let observer = null;
  let startedAt = 0;
  const now = () => performance.now();
  const round = n => Math.round(n * 10) / 10;
  const percentile = (arr, p) => {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    return round(sorted[Math.ceil(p * sorted.length) - 1]);
  };
  const stats = values => ({
    count: values.length,
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? round(Math.max(...values)) : null
  });
  globalThis.FDPerf = Object.freeze({
    start() {
      if (observer) observer.disconnect();
      samples.length = 0;
      startedAt = now();
      if (typeof PerformanceObserver !== 'undefined' &&
          PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
        observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            samples.push({ type: 'longtask', duration: entry.duration });
          }
        });
        observer.observe({ entryTypes: ['longtask'] });
      }
      console.info('FDPerf started. Mark actions with FDPerf.measure("week", () => ...), or FDPerf.begin/end around UI clicks.');
    },
    begin(label) {
      const token = { label: String(label), started: now() };
      return token;
    },
    end(token) {
      if (!token || typeof token.started !== 'number') throw Error('Invalid token');
      const duration = now() - token.started;
      samples.push({ type: token.label, duration });
      return round(duration);
    },
    async measure(label, fn) {
      const token = this.begin(label);
      try { return await fn(); }
      finally { this.end(token); }
    },
    report() {
      const groups = {};
      for (const { type, duration } of samples) (groups[type] ??= []).push(duration);
      const summary = Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, stats(v)]));
      console.table(summary);
      return { elapsedMs: round(now() - startedAt), summary, longTasksSupported:
        PerformanceObserver.supportedEntryTypes?.includes('longtask') ?? false };
    },
    stop() { observer?.disconnect(); observer = null; return this.report(); }
  });
})();
