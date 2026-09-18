import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useSyncExternalStore } from 'react'
import { MoonIcon, SunIcon, UserGroupIcon } from '@heroicons/react/outline'

const navigation = [
  { name: 'Clients', href: '/', isActive: (path) => path === '/' || path.startsWith('/clients') },
]

// The initial theme is applied before first paint by pages/_document.js; this
// just mirrors the <html data-theme> attribute so the toggle icon stays in sync.
function subscribeToTheme(callback) {
  window.addEventListener('theme-change', callback)
  return () => window.removeEventListener('theme-change', callback)
}
const getTheme = () => document.documentElement.getAttribute('data-theme') || 'light'
const getServerTheme = () => 'light'

function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, getTheme, getServerTheme)
  const next = theme === 'dark' ? 'light' : 'dark'

  const toggle = () => {
    document.documentElement.setAttribute('data-theme', next)
    try {
      localStorage.setItem('theme', next)
    } catch {
      // Storage can be unavailable (private mode); the theme still applies for this visit.
    }
    window.dispatchEvent(new Event('theme-change'))
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="btn btn-ghost btn-circle"
      aria-label={`Switch to ${next} theme`}
    >
      {theme === 'dark' ? <SunIcon className="h-6 w-6" /> : <MoonIcon className="h-6 w-6" />}
    </button>
  )
}

export default function Layout({ title, children }) {
  const { pathname } = useRouter()

  return (
    <>
      <Head>
        <title>{title ? `${title} | Dev CRM` : 'Dev CRM'}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="min-h-screen bg-base-200 text-base-content">
        <header className="sticky top-0 z-40 border-b border-base-300 bg-base-100">
          <div className="navbar mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="flex-1 gap-6">
              <Link href="/" className="flex items-center gap-2 text-xl font-bold">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-content">
                  <UserGroupIcon className="h-5 w-5" />
                </span>
                Dev CRM
              </Link>
              <nav className="hidden gap-1 sm:flex">
                {navigation.map((item) => (
                  <Link
                    key={item.name}
                    href={item.href}
                    aria-current={item.isActive(pathname) ? 'page' : undefined}
                    className={`btn btn-sm ${item.isActive(pathname) ? 'btn-primary' : 'btn-ghost'}`}
                  >
                    {item.name}
                  </Link>
                ))}
              </nav>
            </div>
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </>
  )
}
