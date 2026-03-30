import { Bell } from 'lucide-react'

export function RemindersPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="bg-slate-100 p-4 rounded-full mb-4">
        <Bell size={32} className="text-slate-400" />
      </div>
      <h2 className="text-xl font-heading font-bold text-slate-900 mb-2">Reminders</h2>
      <p className="text-slate-500 text-sm max-w-md">
        View and manage user reminders. Coming in Phase 4.
      </p>
      <span className="mt-4 text-xs bg-brand-50 text-brand-600 px-3 py-1 rounded-full font-medium">
        Coming Soon
      </span>
    </div>
  )
}
