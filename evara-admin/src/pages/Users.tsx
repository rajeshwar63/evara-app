import { Users as UsersIcon } from 'lucide-react'

export function UsersPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="bg-slate-100 p-4 rounded-full mb-4">
        <UsersIcon size={32} className="text-slate-400" />
      </div>
      <h2 className="text-xl font-heading font-bold text-slate-900 mb-2">User Management</h2>
      <p className="text-slate-500 text-sm max-w-md">
        Detailed user management features are coming in Phase 2. You'll be able to view, search,
        and manage all Evara users from here.
      </p>
      <span className="mt-4 text-xs bg-brand-50 text-brand-600 px-3 py-1 rounded-full font-medium">
        Coming Soon
      </span>
    </div>
  )
}
