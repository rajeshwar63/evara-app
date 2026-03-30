import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: number | string
  subtext?: string
  icon: LucideIcon
  iconColor?: string
  iconBg?: string
  isLoading?: boolean
}

export function StatCard({
  label,
  value,
  subtext,
  icon: Icon,
  iconColor = 'text-brand-600',
  iconBg = 'bg-brand-50',
  isLoading,
}: StatCardProps) {
  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          {isLoading ? (
            <div className="mt-2 h-8 w-20 bg-slate-100 rounded animate-pulse" />
          ) : (
            <p className="mt-2 text-3xl font-heading font-bold text-slate-900">
              {typeof value === 'number' ? value.toLocaleString() : value}
            </p>
          )}
          {subtext && !isLoading && (
            <p className="mt-1 text-sm text-emerald-600 font-medium">{subtext}</p>
          )}
        </div>
        <div className={`${iconBg} ${iconColor} p-3 rounded-lg`}>
          <Icon size={24} />
        </div>
      </div>
    </div>
  )
}
