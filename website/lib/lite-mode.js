'use client';

import * as React from 'react';

export const LITE_KEY = 'om_lite_ui';

/**
 * "Lite UI" — drops the frosted-glass blur, the animated background and the
 * heavier shadows so the app stays smooth on an older phone.
 *
 * It's a per-DEVICE choice, so it lives in localStorage rather than on the
 * account: the same person should still get the full look on a laptop that can
 * handle it. There is deliberately NO auto-detection — guessing a phone's
 * capability is unreliable and would flip people between two looks for no
 * visible reason. The switch lives in Profile → Appearance.
 *
 * The attribute itself is set before first paint by a small script in the root
 * layout, so the app never flashes the heavy UI first.
 */
export function useLiteMode() {
  const [lite, setLite] = React.useState(false);

  // Read what the pre-paint script already applied (avoids a hydration mismatch).
  React.useEffect(() => {
    setLite(document.documentElement.dataset.lite === 'true');
  }, []);

  const setLiteMode = React.useCallback((on) => {
    if (typeof document !== 'undefined') {
      if (on) document.documentElement.dataset.lite = 'true';
      else delete document.documentElement.dataset.lite;
    }
    try {
      window.localStorage.setItem(LITE_KEY, on ? '1' : '0');
    } catch {
      // Storage blocked (private mode) — the switch still applies for this session.
    }
    setLite(on);
  }, []);

  return { lite, setLiteMode };
}
