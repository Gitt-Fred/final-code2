import Head from 'next/head'
import { UserGroupIcon } from '@heroicons/react/outline'

// Centered card used by the signed-out pages (login and first-run setup).
export default function AuthCard({ title, subtitle, children }) {
  return (
    <>
      <Head>
        <title>{`${title} | Dev CRM`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="flex min-h-screen items-center justify-center bg-base-200 px-4 py-12 text-base-content">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center justify-center gap-2 text-2xl font-bold">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-content">
              <UserGroupIcon className="h-6 w-6" />
            </span>
            Dev CRM
          </div>
          <div className="rounded-2xl border border-base-300 bg-base-100 p-8 shadow-sm">
            <h1 className="text-xl font-semibold">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-base-content/70">{subtitle}</p> : null}
            <div className="mt-6">{children}</div>
          </div>
        </div>
      </div>
    </>
  )
}
