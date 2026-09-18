import { Fragment, useSyncExternalStore } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { Menu, Transition } from '@headlessui/react'
import {
  ChevronDownIcon,
  KeyIcon,
  LogoutIcon,
  MoonIcon,
  SunIcon,
  UserGroupIcon,
  UsersIcon,
} from '@heroicons/react/outline'
import { api } from '../lib/api'
import Avatar from './Avatar'
import { useToast } from './Toast'

// The initial theme is applied before first paint by public/theme-init.js; this
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

function menuItemClass(active) {
  return `flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${active ? 'bg-base-200' : ''}`
}

function UserMenu({ user }) {
  const router = useRouter()
  const toast = useToast()

  const logout = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: {}, redirectOnAuthError: false })
      router.push('/login')
    } catch (error) {
      toast(error.message, 'error')
    }
  }

  return (
    <Menu as="div" className="relative">
      <Menu.Button className="btn btn-ghost gap-2 normal-case">
        <Avatar name={user.name} size="sm" />
        <span className="hidden max-w-[10rem] truncate sm:inline">{user.name}</span>
        <ChevronDownIcon className="h-4 w-4" />
      </Menu.Button>
      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="opacity-0 scale-95"
        enterTo="opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="opacity-100 scale-100"
        leaveTo="opacity-0 scale-95"
      >
        <Menu.Items className="absolute right-0 z-50 mt-2 w-60 origin-top-right rounded-xl border border-base-300 bg-base-100 p-2 shadow-lg focus:outline-none">
          <div className="px-3 py-2">
            <p className="truncate font-medium">{user.name}</p>
            <p className="truncate text-sm text-base-content/60">{user.email}</p>
            <span className="badge badge-outline badge-sm mt-1">{user.role}</span>
          </div>
          <div className="my-1 border-t border-base-300" />
          <Menu.Item>
            {({ active }) => (
              <Link href="/account" className={menuItemClass(active)}>
                <KeyIcon className="h-4 w-4" />
                Account and password
              </Link>
            )}
          </Menu.Item>
          {user.role === 'admin' ? (
            <Menu.Item>
              {({ active }) => (
                <Link href="/admin/users" className={menuItemClass(active)}>
                  <UsersIcon className="h-4 w-4" />
                  Manage users
                </Link>
              )}
            </Menu.Item>
          ) : null}
          <Menu.Item>
            {({ active }) => (
              <button type="button" onClick={logout} className={menuItemClass(active)}>
                <LogoutIcon className="h-4 w-4" />
                Log out
              </button>
            )}
          </Menu.Item>
        </Menu.Items>
      </Transition>
    </Menu>
  )
}

const navigation = [
  { name: 'Clients', href: '/', isActive: (path) => path === '/' || path.startsWith('/clients') },
  { name: 'Users', href: '/admin/users', adminOnly: true, isActive: (path) => path.startsWith('/admin') },
]

export default function Layout({ title, user, children }) {
  const { pathname } = useRouter()
  const links = navigation.filter((item) => !item.adminOnly || user?.role === 'admin')

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
                {links.map((item) => (
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
            {user ? <UserMenu user={user} /> : null}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </>
  )
}
