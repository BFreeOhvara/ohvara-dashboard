import { clsx } from 'clsx'

const STATUS_COLORS = {
  'New':           'bg-slate-700 text-slate-200',
  'Contacted':     'bg-blue-900 text-blue-200',
  'Voicemail':     'bg-yellow-900 text-yellow-200',
  'No Answer':     'bg-orange-900 text-orange-200',
  'Interested':    'bg-green-900 text-green-200',
  'Booked':        'bg-indigo-900 text-indigo-200',
  'Not Interested':'bg-red-900 text-red-200',
  'closed':        'bg-green-900 text-green-200',
  'lost':          'bg-red-900 text-red-200',
  'no_show':       'bg-gray-700 text-gray-300',
  'pending':       'bg-yellow-900 text-yellow-200',
  'rep':           'bg-slate-700 text-slate-200',
  'closer':        'bg-indigo-900 text-indigo-200',
  'admin':         'bg-purple-900 text-purple-200',
}

export function Badge({ label, variant }) {
  const color = STATUS_COLORS[label] || STATUS_COLORS[variant] || 'bg-slate-700 text-slate-300'
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', color)}>
      {label}
    </span>
  )
}
