// Runs before first paint (loaded from pages/_document.js) so the saved, or the
// OS-preferred, theme applies without a flash. External file so the CSP can forbid
// inline scripts.
try {
  var saved = localStorage.getItem('theme');
  // Only the two known themes: storage is never written straight into the DOM.
  var theme =
    saved === 'light' || saved === 'dark'
      ? saved
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  document.documentElement.setAttribute('data-theme', theme);
} catch (e) {}
