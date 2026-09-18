import { safeUrl } from '../lib/format'

export default function ClientNews({ company, articles }) {
  return (
    <section className="rounded-2xl border border-base-300 bg-base-100 p-6">
      <h2 className="mb-4 text-xl font-semibold">Latest news</h2>

      {articles.length === 0 ? (
        <p className="text-base-content/70">
          {company ? `No news found for ${company}.` : 'Add a company to this customer to see related news.'}
        </p>
      ) : (
        <ul className="space-y-4">
          {articles.map((article, index) => {
            const href = safeUrl(article.url)
            return (
              <li key={article.url || index} className="rounded-lg bg-base-200 p-4">
                <h3 className="font-medium">{article.title}</h3>
                {article.description ? (
                  <p className="mt-1 text-sm text-base-content/70">{article.description}</p>
                ) : null}
                {href ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link link-primary mt-2 inline-block text-sm"
                  >
                    Continue reading
                  </a>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
