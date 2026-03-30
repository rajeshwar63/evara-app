import {
  Users,
  UserCheck,
  UserPlus,
  Crown,
  FileText,
  Calendar,
  Bell,
  Search,
  HardDrive,
  FileBarChart,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { UserGrowthChart } from '../components/UserGrowthChart'
import { PlanDistribution } from '../components/PlanDistribution'
import { DocumentTypeChart } from '../components/DocumentTypeChart'
import { RecentActivity } from '../components/RecentActivity'
import { useDashboardStats } from '../hooks/useDashboardStats'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function Dashboard() {
  const stats = useDashboardStats()

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-heading font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            Overview of Evara's health and activity
          </p>
        </div>
        <p className="text-xs text-slate-400">
          Last updated: {stats.lastUpdated.toLocaleTimeString()}
        </p>
      </div>

      {/* Top Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <StatCard
          label="Total Users"
          value={stats.totalUsers}
          subtext={stats.newUsersThisWeek > 0 ? `+${stats.newUsersThisWeek} this week` : undefined}
          icon={Users}
          iconColor="text-brand-600"
          iconBg="bg-brand-50"
          isLoading={stats.isLoading}
        />
        <StatCard
          label="Free Users"
          value={stats.freeUsers}
          icon={UserCheck}
          iconColor="text-slate-600"
          iconBg="bg-slate-100"
          isLoading={stats.isLoading}
        />
        <StatCard
          label="Trial Users"
          value={stats.trialUsers}
          icon={UserPlus}
          iconColor="text-blue-600"
          iconBg="bg-blue-50"
          isLoading={stats.isLoading}
        />
        <StatCard
          label="Paid Users"
          value={stats.paidUsers}
          icon={Crown}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50"
          isLoading={stats.isLoading}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <UserGrowthChart data={stats.userGrowth} isLoading={stats.isLoading} />
        <PlanDistribution data={stats.planDistribution} isLoading={stats.isLoading} />
      </div>

      {/* Documents & Quick Stats Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <DocumentTypeChart
          data={stats.documentsByType}
          docsToday={stats.docsToday}
          docsThisWeek={stats.docsThisWeek}
          docsThisMonth={stats.docsThisMonth}
          isLoading={stats.isLoading}
        />

        {/* Quick Stats Grid */}
        <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
          <h3 className="text-base font-heading font-semibold text-slate-900 mb-4">
            Quick Stats
          </h3>
          {stats.isLoading ? (
            <div className="grid grid-cols-2 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-20 bg-slate-50 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <QuickStat icon={FileText} label="Docs Today" value={stats.docsToday} />
              <QuickStat icon={Calendar} label="Docs This Week" value={stats.docsThisWeek} />
              <QuickStat icon={Bell} label="Active Reminders" value={stats.activeReminders} />
              <QuickStat icon={Search} label="Searches Today" value={stats.searchesToday} />
              <QuickStat
                icon={HardDrive}
                label="Total Storage"
                value={formatBytes(stats.totalStorage)}
              />
              <QuickStat
                icon={FileBarChart}
                label="Avg Docs/User"
                value={stats.avgDocsPerUser}
              />
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <RecentActivity />

      {/* Error banner */}
      {stats.error && (
        <div className="fixed bottom-4 right-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4 shadow-lg max-w-sm">
          <p className="font-medium">Error loading data</p>
          <p className="mt-1 text-xs">{stats.error}</p>
        </div>
      )}
    </div>
  )
}

function QuickStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users
  label: string
  value: number | string
}) {
  return (
    <div className="bg-slate-50 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className="text-slate-400" />
        <span className="text-xs text-slate-500">{label}</span>
      </div>
      <p className="text-xl font-heading font-bold text-slate-900">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
    </div>
  )
}
