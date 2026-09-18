import { getInitials } from '../lib/format'

// Classes are listed in full so Tailwind can see them.
const palette = [
  'bg-primary text-primary-content',
  'bg-secondary text-secondary-content',
  'bg-accent text-accent-content',
  'bg-info text-info-content',
  'bg-success text-success-content',
  'bg-warning text-warning-content',
]

const sizes = {
  sm: 'h-8 w-8 text-sm',
  md: 'h-12 w-12 text-lg',
  lg: 'h-20 w-20 text-3xl',
}

export default function Avatar({ name, size = 'md' }) {
  const seed = String(name || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${sizes[size]} ${palette[seed % palette.length]}`}
      aria-hidden="true"
    >
      {getInitials(name)}
    </div>
  )
}
