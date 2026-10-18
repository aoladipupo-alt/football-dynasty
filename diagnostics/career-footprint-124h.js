/* Football Dynasty 1.24h - local browser save-footprint inspection.
 * Development diagnostic. No save contents are logged or modified.
 * To run: paste into DevTools, then FDStorageFootprint124h.report().
 */
(() => {
  if (typeof window === 'undefined' || window.FDStorageFootprint124h) return;
  const bytes = value => 2 * String(value || '').length; // approximate UTF-16 in-memory size
  const kind = key => {
    const bare = key.replace(/^fd-save-[1-5]-/, '');
    if (/world-state|shadow-prospects/i.test(bare)) return 'World and foreign academies';
    if (/player-career-state/i.test(bare)) return 'Career player snapshots';
    if (/match-saves/i.test(bare)) return 'Match history';
    if (/transfer-state/i.test(bare)) return 'Transfer history';
    if (/training-state/i.test(bare)) return 'Training and development';
    return 'Other save metadata';
  };
  function report() {
    let store;
    try { store = window.localStorage; }
    catch (error) {
      console.warn('Football Dynasty save-size inspection unavailable:', error?.message);
      return null;
    }
    const slots = Array.from({ length: 5 }, (_, i) => ({
      slot: i + 1, keys: 0, approximateBytes: 0,
      categories: Object.create(null)
    }));
    let total = 0;
    try {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        const match = /^fd-save-([1-5])-/.exec(key || '');
        if (!match) continue;
        const slot = slots[Number(match[1]) - 1];
        // Read each value once; do NOT parse, save or print its contents.
        const value = store.getItem(key);
        const length = bytes(key) + bytes(value);
        slot.keys++;
        slot.approximateBytes += length;
        const category = kind(key);
        slot.categories[category] = (slot.categories[category] || 0) + length;
        total += length;
      }
    } catch (error) {
      console.warn('Football Dynasty save-size inspection failed:', error?.message);
      return null;
    }
    const rounded = n => Math.round(n / 1024);
    const summary = slots.map(row => ({
      slot: row.slot, saveKeys: row.keys,
      approxKiB: rounded(row.approximateBytes),
      ...Object.fromEntries(Object.entries(row.categories).map(([category,n]) => [category+' KiB',rounded(n)]))
    }));
    console.table(summary);
    console.info('Total approximate UTF-16 bytes across career slots:', total);
    console.info('Lengths only. No career data was logged, exported or changed.');
    return { units: 'approximate UTF-16 bytes (not browser quota usage)', totalApproximateBytes: total, slots: summary };
  }
  Object.defineProperty(window, 'FDStorageFootprint124h', {
    value: Object.freeze({ report }), configurable: true
  });
})();
