import { Html, Head, Main, NextScript } from 'next/document'

// Runs before first paint so the saved (or OS-preferred) theme applies without a flash.
const setInitialTheme = `try {
  var theme = localStorage.getItem('theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
} catch (e) {}`

export default function Document() {
  return (
    <Html lang="en">
      <Head />
      <body>
        <script dangerouslySetInnerHTML={{ __html: setInitialTheme }} />
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
