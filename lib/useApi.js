import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

// GETs `url` (pass null to skip). Keeps the previous result on screen while a
// new request is in flight; `reload()` refetches the same url.
export default function useApi(url) {
  const [version, setVersion] = useState(0)
  const [result, setResult] = useState({ key: null, json: null, error: null })
  const key = `${version}:${url}`

  useEffect(() => {
    if (!url) return
    let cancelled = false
    api(url)
      .then((json) => {
        if (!cancelled) setResult({ key, json, error: null })
      })
      .catch((error) => {
        if (!cancelled) setResult({ key, json: null, error })
      })
    return () => {
      cancelled = true
    }
  }, [url, key])

  const reload = useCallback(() => setVersion((v) => v + 1), [])

  return {
    data: result.json,
    error: result.key === key ? result.error : null,
    loading: Boolean(url) && result.key !== key,
    reload,
  }
}
