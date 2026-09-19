import { useRef, useState } from 'react'
import Image from 'next/image'
import { DocumentTextIcon, DownloadIcon, PaperClipIcon, TrashIcon, UploadIcon } from '@heroicons/react/outline'
import { api, upload } from '../lib/api'
import { formatBytes, formatDate } from '../lib/format'
import useApi from '../lib/useApi'
import { useToast } from './Toast'

// Mirrors the server's allowlist so the picker only offers files that will be
// accepted. It is a convenience: the server checks the actual bytes regardless.
const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.docx,.xlsx,.pptx,.odt,.ods,.odp,.txt,.csv'
const MAX_BYTES = 10 * 1024 * 1024

function FileIcon({ file }) {
  if (file.kind === 'image') {
    // Unoptimized: the image optimizer would fetch without the session cookie.
    return (
      <Image
        src={`/api/files/${file._id}`}
        alt=""
        width={40}
        height={40}
        unoptimized
        className="h-10 w-10 shrink-0 rounded-md bg-base-300 object-cover"
      />
    )
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-base-300">
      <DocumentTextIcon className="h-6 w-6 text-base-content/70" />
    </div>
  )
}

export default function Attachments({ clientId, currentUser }) {
  const toast = useToast()
  const inputRef = useRef(null)
  const { data, error, reload } = useApi(`/api/clients/${clientId}/files`)
  const [progress, setProgress] = useState(null)
  const [dragging, setDragging] = useState(false)

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || [])
    for (const file of files) {
      if (file.size > MAX_BYTES) {
        toast(`${file.name} is larger than 10 MB`, 'error')
        continue
      }
      setProgress(0)
      try {
        await upload(`/api/clients/${clientId}/files`, file, { onProgress: setProgress })
        toast(`Uploaded ${file.name}`)
      } catch (err) {
        toast(`${file.name}: ${err.message}`, 'error')
      }
    }
    setProgress(null)
    if (inputRef.current) inputRef.current.value = ''
    reload()
  }

  const deleteFile = async (fileId) => {
    try {
      await api(`/api/files/${fileId}`, { method: 'DELETE' })
      toast('File deleted')
      reload()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const onDrop = (event) => {
    event.preventDefault()
    setDragging(false)
    if (progress === null) uploadFiles(event.dataTransfer.files)
  }

  const files = data?.data ?? []
  const uploading = progress !== null

  return (
    <section className="rounded-2xl border border-base-300 bg-base-100 p-6">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
        <PaperClipIcon className="h-5 w-5" />
        Files
      </h2>

      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`mb-6 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
          dragging ? 'border-primary bg-primary/5' : 'border-base-300'
        }`}
      >
        <UploadIcon className="mx-auto mb-2 h-8 w-8 text-base-content/50" />
        <p className="text-sm text-base-content/70">
          Drop files here, or{' '}
          <button
            type="button"
            className="link link-primary"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            browse
          </button>
        </p>
        <p className="mt-1 text-xs text-base-content/50">
          Images, PDF, Office and OpenDocument files, TXT or CSV. Up to 10 MB each.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(event) => uploadFiles(event.target.files)}
          aria-label="Upload files"
        />
        {uploading ? (
          <progress className="progress progress-primary mt-4 w-full" value={Math.round(progress * 100)} max="100" />
        ) : null}
      </div>

      {error ? (
        <div className="alert alert-error text-sm">
          <span>Could not load files: {error.message}</span>
          <button type="button" className="btn btn-xs" onClick={reload}>
            Retry
          </button>
        </div>
      ) : !data ? (
        <div className="h-14 animate-pulse rounded-lg bg-base-200" />
      ) : files.length === 0 ? (
        <p className="text-base-content/70">No files yet.</p>
      ) : (
        <ul className="space-y-2">
          {files.map((file) => {
            // The API enforces this too: uploaders delete their own files, admins any.
            const canDelete = currentUser.role === 'admin' || file.createdBy?._id === currentUser.id
            return (
              <li key={file._id} className="flex items-center gap-3 rounded-lg bg-base-200 p-3">
                <FileIcon file={file} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={file.filename}>
                    {file.filename}
                  </p>
                  <p className="text-xs text-base-content/60">
                    {formatBytes(file.size)}
                    {file.createdBy?.name ? ` · ${file.createdBy.name}` : ''}
                    {` · ${formatDate(file.createdAt)}`}
                  </p>
                </div>
                <a href={`/api/files/${file._id}`} className="btn btn-ghost btn-xs" aria-label={`Download ${file.filename}`}>
                  <DownloadIcon className="h-4 w-4" />
                </a>
                {canDelete ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => deleteFile(file._id)}
                    aria-label={`Delete ${file.filename}`}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
