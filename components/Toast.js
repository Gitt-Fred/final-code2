import { createContext, useCallback, useContext, useState } from 'react'

const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const push = useCallback((message, type = 'success') => {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((current) => [...current, { id, message, type }])
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id))
    }, 4000)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast toast-end z-[60]" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`alert ${toast.type === 'error' ? 'alert-error' : 'alert-success'} shadow-lg`}
          >
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// Returns notify(message, type) where type is 'success' (default) or 'error'.
export const useToast = () => useContext(ToastContext)
