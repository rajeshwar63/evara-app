import { useEffect, useState, useCallback } from 'react'
import { Activity } from 'lucide-react'
import { getRecentActivity, type ActivityEntry } from '../lib/queries'

function maskPhone(phone: string): string {
  if (phone.length < 6) return '****'
  return phone.slice(0, 3) + '****' + phone.slice(-4)
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

const TYPE_BADGES: Record<string, { label: string; color: string }> = {
  image: { label: 'Image', color: 'bg-blue-50 text-blue-700' },
  pdf: { label: 'PDF', color: 'bg-red-50 text-red-700' },
  text_note: { label: 'Text', color: 'bg-green-50 text-green-700' },
  text: { label: 'Text', color: 'bg-green-50 text-green-700' },
  link: { label: 'Link', color: 'bg-purple-50 text-purple-700' },
}

export function RecentActivity() {
  const [activities, setActivities] = useState<ActivityEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchActivity = useCallback(async () => {
    try {
      const data = await getRecentActivity(20)
      setActivities(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchActivity()
    const interval = setInterval(fetchActivity, 30000)
    return () => clearInterval(interval)
  }, [fetchActivity])

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-heading font-semibold text-slate-900">Recent Activity</h3>
        <Activity size={18} className="text-slate-400" />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="h-8 w-8 bg-slate-100 rounded-full" />
              <div className="flex-1">
                <div className="h-3 w-3/4 bg-slate-100 rounded" />
                <div className="h-2.5 w-1/2 bg-slate-50 rounded mt-1.5" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : activities.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">No activity yet</p>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {activities.map((entry, i) => {
            const badge = TYPE_BADGES[entry.message_type] || {
              label: entry.message_type,
              color: 'bg-slate-50 text-slate-700',
            }
            return (
              <div
                key={entry.id || i}
                className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <div className="w-2 h-2 rounded-full bg-brand-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-700 font-medium">
                      {maskPhone(entry.phone_number)}
                    </span>
                    <span
                      className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${badge.color}`}
                    >
                      {badge.label}
                    </span>
                    <span className="text-[11px] text-slate-400 capitalize">
                      {entry.direction}
                    </span>
                  </div>
                </div>
                <span className="text-xs text-slate-400 flex-shrink-0">
                  {formatTime(entry.created_at)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
