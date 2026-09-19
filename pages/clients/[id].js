import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import {
  ArrowLeftIcon,
  GlobeAltIcon,
  MailIcon,
  OfficeBuildingIcon,
  PencilIcon,
  TrashIcon,
} from '@heroicons/react/outline'
import Attachments from '../../components/Attachments'
import Avatar from '../../components/Avatar'
import ClientForm from '../../components/ClientForm'
import ClientNews from '../../components/ClientNews'
import Layout from '../../components/Layout'
import Modal from '../../components/Modal'
import Notes from '../../components/Notes'
import { useToast } from '../../components/Toast'
import { api } from '../../lib/api'
import { requireUserSSR } from '../../lib/auth'
import { safeUrl } from '../../lib/format'
import useApi from '../../lib/useApi'

export async function getServerSideProps(context) {
  return requireUserSSR(context)
}

function BackLink() {
  return (
    <Link href="/" className="btn btn-ghost btn-sm mb-4">
      <ArrowLeftIcon className="mr-1 h-4 w-4" />
      All customers
    </Link>
  )
}

export default function ClientDetail({ user }) {
  const router = useRouter()
  const toast = useToast()
  const { id } = router.query
  const { data, error, reload } = useApi(id ? `/api/clients/${id}` : null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [removing, setRemoving] = useState(false)

  const client = data?.data

  const saveClient = async (values) => {
    await api(`/api/clients/${id}`, { method: 'PUT', body: values })
    toast('Customer updated')
    setEditing(false)
    reload()
  }

  const deleteClient = async () => {
    setRemoving(true)
    try {
      await api(`/api/clients/${id}`, { method: 'DELETE' })
      toast('Customer deleted')
      router.push('/')
    } catch (err) {
      toast(err.message, 'error')
      setRemoving(false)
      setDeleting(false)
    }
  }

  let content
  if (error) {
    content = (
      <div className="rounded-2xl border border-base-300 bg-base-100 p-12 text-center">
        <p className="text-lg font-medium">Customer not found</p>
        <p className="mt-1 text-base-content/70">{error.message}</p>
      </div>
    )
  } else if (!client) {
    content = <div className="h-40 animate-pulse rounded-2xl bg-base-100" />
  } else {
    const website = safeUrl(client.website)
    content = (
      <div className="space-y-6">
        <section className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-base-300 bg-base-100 p-6">
          <div className="flex items-center gap-5">
            <Avatar name={client.name} size="lg" />
            <div className="min-w-0">
              <h1 className="break-words text-3xl font-bold">{client.name}</h1>
              <ul className="mt-2 space-y-1 text-base-content/70">
                {client.company ? (
                  <li className="flex items-center gap-2">
                    <OfficeBuildingIcon className="h-5 w-5 shrink-0" />
                    {client.company}
                  </li>
                ) : null}
                {client.email ? (
                  <li className="flex items-center gap-2">
                    <MailIcon className="h-5 w-5 shrink-0" />
                    <a href={`mailto:${client.email}`} className="link link-hover break-all">
                      {client.email}
                    </a>
                  </li>
                ) : null}
                {website ? (
                  <li className="flex items-center gap-2">
                    <GlobeAltIcon className="h-5 w-5 shrink-0" />
                    <a
                      href={website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link link-hover break-all"
                    >
                      {client.website}
                    </a>
                  </li>
                ) : null}
              </ul>
              {client.createdBy?.name ? (
                <p className="mt-3 text-xs text-base-content/50">Added by {client.createdBy.name}</p>
              ) : null}
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(true)}>
              <PencilIcon className="mr-1 h-4 w-4" />
              Edit
            </button>
            {/* Hidden for members as a courtesy; the API enforces admin-only delete. */}
            {user.role === 'admin' ? (
              <button type="button" className="btn btn-outline btn-error btn-sm" onClick={() => setDeleting(true)}>
                <TrashIcon className="mr-1 h-4 w-4" />
                Delete
              </button>
            ) : null}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Notes clientId={client._id} currentUser={user} />
            <Attachments clientId={client._id} currentUser={user} />
          </div>
          <ClientNews company={client.company} articles={client.articles} />
        </div>

        <Modal open={editing} onClose={() => setEditing(false)} title="Edit customer">
          <ClientForm
            initialValues={client}
            submitLabel="Save changes"
            onSubmit={saveClient}
            onCancel={() => setEditing(false)}
          />
        </Modal>

        <Modal open={deleting} onClose={() => setDeleting(false)} title="Delete customer">
          <p className="mb-6">
            Delete <strong>{client.name}</strong>? Their notes and files will be deleted too. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setDeleting(false)} disabled={removing}>
              Cancel
            </button>
            <button
              type="button"
              className={`btn btn-error ${removing ? 'loading' : ''}`}
              onClick={deleteClient}
              disabled={removing}
            >
              Delete
            </button>
          </div>
        </Modal>
      </div>
    )
  }

  return (
    <Layout title={client?.name || 'Customer'} user={user}>
      <BackLink />
      {content}
    </Layout>
  )
}
