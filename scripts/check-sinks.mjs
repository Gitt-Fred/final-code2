// Fails when app code uses a DOM API that parses a string as HTML or code. React
// escapes everything it renders, so these are the ways XSS gets back in. ESLint's
// react/no-danger covers dangerouslySetInnerHTML in JSX; this also catches the raw
// DOM APIs, which ESLint has no core rule for. Run with: npm run lint:sinks
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOTS = ['pages', 'components', 'lib', 'public']
const EXTENSIONS = /\.(js|jsx|mjs|cjs|ts|tsx)$/
const SINKS = [
  { name: 'innerHTML', pattern: /\.innerHTML\b/ },
  { name: 'outerHTML', pattern: /\.outerHTML\b/ },
  { name: 'insertAdjacentHTML', pattern: /\binsertAdjacentHTML\b/ },
  { name: 'document.write', pattern: /\bdocument\.write(ln)?\b/ },
  { name: 'new Function', pattern: /\bnew\s+Function\b/ },
  { name: 'dangerouslySetInnerHTML', pattern: /\bdangerouslySetInnerHTML\b/ },
  { name: 'srcdoc', pattern: /\bsrcdoc\b/i },
  { name: 'createContextualFragment', pattern: /\bcreateContextualFragment\b/ },
  { name: 'setTimeout/setInterval with a string', pattern: /\bset(Timeout|Interval)\(\s*['"`]/ },
]

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* walk(path)
    else if (EXTENSIONS.test(name)) yield path
  }
}

const findings = []
for (const root of ROOTS) {
  for (const file of walk(root)) {
    readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .forEach((line, index) => {
        for (const sink of SINKS) {
          if (sink.pattern.test(line)) findings.push(`${relative('.', file)}:${index + 1}  ${sink.name}`)
        }
      })
  }
}

if (findings.length > 0) {
  console.error('Unsafe DOM sinks found (these parse strings as HTML or code):')
  for (const finding of findings) console.error(`  ${finding}`)
  console.error('\nRender text through React instead. See docs/SECURITY.md, "Content handling".')
  process.exit(1)
}
console.log(`No unsafe DOM sinks in ${ROOTS.join(', ')}.`)
