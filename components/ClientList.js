import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MailIcon,
  OfficeBuildingIcon,
  PlusIcon,
  SearchIcon,
} from '@heroicons/react/outline'
import { api } from '../lib/api'
import useApi from '../lib/useApi'
import Avatar from './Avatar'
import ClientForm from './ClientForm'
import Modal from './Modal'
import { useToast } from './Toast'

const PAGE_SIZE = 12

function ClientCard({ client }) {
  return (
    <Link
      href={`/clients/${client._id}`}
      className="card border border-base-300 bg-base-100 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="card-body flex-row items-center gap-4 p-5">
        <Avatar name={client.name} />
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{client.name}</h2>
          {client.company ? (
            <p className="flex items-center gap-1 truncate text-sm text-base-content/70">
              <OfficeBuildingIcon className="h-4 w-4 shrink-0" />
              {client.company}
            </p>
          ) : null}
          {client.email ? (
            <p className="flex items-center gap-1 truncate text-sm text-base-content/70">
              <MailIcon className="h-4 w-4 shrink-0" />
              {client.email}
            </p>
          ) : null}
        </div>
      </div>
    </Link>
  )
}

function SkeletonCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="card animate-pulse border border-base-300 bg-base-100">
          <div className="card-body flex-row items-center gap-4 p-5">
            <div className="h-12 w-12 rounded-full bg-base-300" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 rounded bg-base-300" />
              <div className="h-3 w-1/2 rounded bg-base-300" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ClientList() {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)

  // Wait for a pause in typing before searching, and go back to the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  const { data, error, loading, reload } = useApi(
    `/api/clients?page=${page}&limit=${PAGE_SIZE}&q=${encodeURIComponent(search)}`
  )

  const addClient = async (values) => {
    await api('/api/clients', { method: 'POST', body: values })
    toast('Customer added')
    setAdding(false)
    setQuery('')
    setSearch('')
    setPage(1)
    reload()
  }

  const clients = data?.data ?? []
  const pages = data?.pages ?? 1

  let content
  if (error) {
    content = (
      <div className="alert alert-error">
        <span>Could not load customers: {error.message}</span>
        <button type="button" className="btn btn-sm" onClick={reload}>
          Retry
        </button>
      </div>
    )
  } else if (!data) {
    content = <SkeletonCards />
  } else if (clients.length === 0) {
    content = (
      <div className="rounded-2xl border border-dashed border-base-300 bg-base-100 p-12 text-center">
        <p className="text-lg font-medium">{search ? 'No customers match your search' : 'No customers yet'}</p>
        <p className="mt-1 text-base-content/70">
          {search ? 'Try a different name, company, or email.' : 'Add your first customer to get started.'}
        </p>
        {search ? null : (
          <button type="button" className="btn btn-primary mt-6" onClick={() => setAdding(true)}>
            <PlusIcon className="mr-1 h-5 w-5" />
            Add customer
          </button>
        )}
      </div>
    )
  } else {
    content = (
      <div className={`grid gap-4 sm:grid-cols-2 lg:grid-cols-3 ${loading ? 'opacity-60' : ''}`}>
        {clients.map((client) => (
          <ClientCard key={client._id} client={client} />
        ))}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Customers</h1>
          {data ? (
            <p className="text-base-content/70">
              {data.total} {data.total === 1 ? 'customer' : 'customers'}
            </p>
          ) : null}
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          <PlusIcon className="mr-1 h-5 w-5" />
          Add customer
        </button>
      </div>

      <div className="relative mb-6">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-base-content/50" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, company, or email"
          className="input input-bordered w-full pl-10"
          aria-label="Search customers"
        />
      </div>

      {content}

      {data && pages > 1 ? (
        <div className="mt-8 flex items-center justify-center gap-4">
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => setPage((current) => current - 1)}
            disabled={page <= 1}
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Previous
          </button>
          <span className="text-sm text-base-content/70">
            Page {page} of {pages}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => setPage((current) => current + 1)}
            disabled={page >= pages}
          >
            Next
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      <Modal open={adding} onClose={() => setAdding(false)} title="Add customer">
        <ClientForm submitLabel="Add customer" onSubmit={addClient} onCancel={() => setAdding(false)} />
      </Modal>
    </div>
  )
}
