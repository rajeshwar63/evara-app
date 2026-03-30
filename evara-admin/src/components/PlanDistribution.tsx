import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'

interface PlanDistributionProps {
  data: { plan: string; count: number }[]
  isLoading?: boolean
}

const PLAN_COLORS: Record<string, string> = {
  free: '#94A3B8',
  trial: '#3B82F6',
  individual: '#10B981',
  family: '#8B5CF6',
}

const PLAN_LABELS: Record<string, string> = {
  free: 'Free',
  trial: 'Trial',
  individual: 'Individual',
  family: 'Family',
}

export function PlanDistribution({ data, isLoading }: PlanDistributionProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
        <div className="h-5 w-40 bg-slate-100 rounded animate-pulse mb-6" />
        <div className="h-64 bg-slate-50 rounded animate-pulse" />
      </div>
    )
  }

  const total = data.reduce((sum, d) => sum + d.count, 0)
  const chartData = data.map(d => ({
    name: PLAN_LABELS[d.plan] || d.plan,
    value: d.count,
    color: PLAN_COLORS[d.plan] || '#CBD5E1',
    percentage: total > 0 ? ((d.count / total) * 100).toFixed(1) : '0',
  }))

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
      <h3 className="text-base font-heading font-semibold text-slate-900 mb-6">
        Plan Distribution
      </h3>
      {total === 0 ? (
        <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
          No data yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={65}
              outerRadius={100}
              paddingAngle={3}
              dataKey="value"
            >
              {chartData.map((entry, index) => (
                <Cell key={index} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string) => [
                `${value} (${total > 0 ? ((value / total) * 100).toFixed(1) : 0}%)`,
                name,
              ]}
              contentStyle={{
                backgroundColor: '#0F172A',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '13px',
              }}
            />
            <Legend
              verticalAlign="bottom"
              iconType="circle"
              iconSize={10}
              formatter={(value) => (
                <span className="text-sm text-slate-600">{value}</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
