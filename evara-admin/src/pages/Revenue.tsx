import { DollarSign } from 'lucide-react'

export function RevenuePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="bg-slate-100 p-4 rounded-full mb-4">
        <DollarSign size={32} className="text-slate-400" />
      </div>
      <h2 className="text-xl font-heading font-bold text-slate-900 mb-2">Revenue</h2>
      <p className="text-slate-500 text-sm max-w-md">
        Track revenue, subscriptions, and payments. Coming in Phase 5.
      </p>
      <span className="mt-4 text-xs bg-brand-50 text-brand-600 px-3 py-1 rounded-full font-medium">
        Coming Soon
      </span>
    </div>
  )
}
