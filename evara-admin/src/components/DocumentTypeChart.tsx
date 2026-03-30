import { useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface DocumentTypeChartProps {
  data: { message_type: string; count: number }[]
  docsToday: number
  docsThisWeek: number
  docsThisMonth: number
  isLoading?: boolean
}

const TYPE_LABELS: Record<string, string> = {
  image: 'Image',
  pdf: 'PDF',
  text_note: 'Text Note',
  link: 'Link',
}

type Period = 'today' | 'week' | 'month'

export function DocumentTypeChart({
  data,
  docsToday,
  docsThisWeek,
  docsThisMonth,
  isLoading,
}: DocumentTypeChartProps) {
  const [period, setPeriod] = useState<Period>('week')

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
        <div className="h-5 w-48 bg-slate-100 rounded animate-pulse mb-6" />
        <div className="h-64 bg-slate-50 rounded animate-pulse" />
      </div>
    )
  }

  const periodCount = period === 'today' ? docsToday : period === 'week' ? docsThisWeek : docsThisMonth
  const chartData = data.map(d => ({
    name: TYPE_LABELS[d.message_type] || d.message_type,
    count: d.count,
  }))

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-base font-heading font-semibold text-slate-900">
          Documents Processed
        </h3>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5">
          {(['today', 'week', 'month'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                period === p
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {p === 'today' ? 'Today' : p === 'week' ? 'Week' : 'Month'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-2xl font-heading font-bold text-slate-900 mb-4">
        {periodCount.toLocaleString()}
        <span className="text-sm font-normal text-slate-500 ml-2">
          {period === 'today' ? 'today' : period === 'week' ? 'this week' : 'this month'}
        </span>
      </p>
      {chartData.length === 0 ? (
        <div className="h-48 flex items-center justify-center text-slate-400 text-sm">
          No data yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 12, fill: '#94A3B8' }}
              tickLine={false}
              axisLine={{ stroke: '#E2E8F0' }}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#94A3B8' }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#0F172A',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '13px',
              }}
            />
            <Bar dataKey="count" fill="#4F46E5" radius={[4, 4, 0, 0]} name="Documents" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
