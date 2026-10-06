/**
 * Light and dark, shared by the hub and every assessment.
 *
 * Extracted rather than copied: two implementations of "which theme is this"
 * drift, and the failure is a hub that opens light while the assessment it
 * links to opens dark. One key, one source of truth.
 */

const THEME_KEY = 'coa.theme.v1';

/** Only ever 'light' or 'dark'; anything else means "follow the system". */
export function storedTheme() {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null; // private window, or site data blocked - not an error
  }
}

/**
 * What the viewer is actually looking at: the stored choice, or dark.
 *
 * NIGHTSHIFT is dark-first. The OS preference no longer decides the default,
 * because a light-mode laptop opening a near-black marketing site and then a
 * white assessment is exactly the seam the restyle exists to close.
 */
export function activeTheme() {
  return storedTheme() ?? 'dark';
}

export function applyTheme(theme) {
  // setAttribute rather than dataset.theme: assigning to dataset works in a
  // browser but writes into a computed copy anywhere the property is a
  // getter, and then the theme is silently never applied.
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#05070C' : '#F6F7F9');
}

/**
 * Flips the theme and remembers it. `after` lets a caller re-render; the hub
 * is static and passes nothing.
 */
export function toggleTheme(after) {
  const next = activeTheme() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem(THEME_KEY, next); } catch { /* nothing to recover */ }

  // The cross-fade is switched on for the length of the change and off again.
  // Leaving it on would make every ordinary re-render pay for a transition,
  // which is what makes a themed page feel slack.
  const root = document.documentElement;
  root.classList.add('is-theming');
  applyTheme(next);
  window.setTimeout(() => root.classList.remove('is-theming'), 300);
  if (after) after();
  return next;
}

/**
 * The switch itself, built with the caller's element helper so it can be
 * appended straight into whatever is rendering it.
 */
export function themeToggle(h, after) {
  const dark = activeTheme() === 'dark';
  return h('button', {
    class: 'themetog',
    type: 'button',
    'aria-pressed': dark ? 'true' : 'false',
    'aria-label': dark ? 'Switch to light theme' : 'Switch to dark theme',
    title: dark ? 'Light theme' : 'Dark theme',
    onClick: () => toggleTheme(after),
  }, h('span', { class: 'themetog__knob', 'aria-hidden': 'true' }));
}
