import { supabase } from './supabase'

export interface ActivityEntry {
  id: string
  phone_number: string
  message_type: string
  direction: string
  created_at: string
}

// User stats
export async function getUserCount(): Promise<number> {
  const { count, error } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
  if (error) throw error
  return count ?? 0
}

export async function getUserCountByPlan(): Promise<{ plan: string; count: number }[]> {
  const { data, error } = await supabase
    .from('users')
    .select('plan')
  if (error) throw error

  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    const plan = row.plan || 'free'
    counts[plan] = (counts[plan] || 0) + 1
  }
  return Object.entries(counts).map(([plan, count]) => ({ plan, count }))
}

export async function getNewUsersToday(): Promise<number> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const { count, error } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today.toISOString())
  if (error) throw error
  return count ?? 0
}

export async function getNewUsersThisWeek(): Promise<number> {
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  weekAgo.setHours(0, 0, 0, 0)
  const { count, error } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', weekAgo.toISOString())
  if (error) throw error
  return count ?? 0
}

export async function getUserGrowthLast30Days(): Promise<{ date: string; count: number }[]> {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  thirtyDaysAgo.setHours(0, 0, 0, 0)

  const { data, error } = await supabase
    .from('users')
    .select('created_at')
    .gte('created_at', thirtyDaysAgo.toISOString())
    .order('created_at', { ascending: true })
  if (error) throw error

  const dayCounts: Record<string, number> = {}
  for (const row of data ?? []) {
    const date = new Date(row.created_at).toISOString().split('T')[0]
    dayCounts[date] = (dayCounts[date] || 0) + 1
  }

  // Fill in missing days with 0
  const result: { date: string; count: number }[] = []
  const current = new Date(thirtyDaysAgo)
  const today = new Date()
  while (current <= today) {
    const dateStr = current.toISOString().split('T')[0]
    result.push({ date: dateStr, count: dayCounts[dateStr] || 0 })
    current.setDate(current.getDate() + 1)
  }

  // Make cumulative
  let cumulative = 0
  return result.map(item => {
    cumulative += item.count
    return { date: item.date, count: cumulative }
  })
}

// Document stats
export async function getDocumentCountToday(): Promise<number> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const { count, error } = await supabase
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today.toISOString())
  if (error) throw error
  return count ?? 0
}

export async function getDocumentCountThisWeek(): Promise<number> {
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 7)
  weekAgo.setHours(0, 0, 0, 0)
  const { count, error } = await supabase
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', weekAgo.toISOString())
  if (error) throw error
  return count ?? 0
}

export async function getDocumentCountThisMonth(): Promise<number> {
  const monthAgo = new Date()
  monthAgo.setDate(monthAgo.getDate() - 30)
  monthAgo.setHours(0, 0, 0, 0)
  const { count, error } = await supabase
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', monthAgo.toISOString())
  if (error) throw error
  return count ?? 0
}

export async function getDocumentsByType(): Promise<{ message_type: string; count: number }[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('message_type')
  if (error) throw error

  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    const type = row.message_type || 'unknown'
    counts[type] = (counts[type] || 0) + 1
  }
  return Object.entries(counts).map(([message_type, count]) => ({ message_type, count }))
}

export async function getTotalStorageUsed(): Promise<number> {
  const { data, error } = await supabase
    .from('documents')
    .select('file_size_bytes')
  if (error) throw error

  return (data ?? []).reduce((sum, row) => sum + (row.file_size_bytes || 0), 0)
}

// Reminder stats
export async function getActiveRemindersCount(): Promise<number> {
  const { count, error } = await supabase
    .from('reminders')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'active')
  if (error) throw error
  return count ?? 0
}

// Search stats
export async function getSearchCountToday(): Promise<number> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const { count, error } = await supabase
    .from('search_log')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', today.toISOString())
  if (error) throw error
  return count ?? 0
}

// Activity feed
export async function getRecentActivity(limit: number = 20): Promise<ActivityEntry[]> {
  const { data, error } = await supabase
    .from('messages_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as ActivityEntry[]
}

// Derived
export async function getAvgDocsPerUser(): Promise<number> {
  const [docResult, userResult] = await Promise.all([
    supabase.from('documents').select('*', { count: 'exact', head: true }),
    supabase.from('users').select('*', { count: 'exact', head: true }),
  ])
  if (docResult.error) throw docResult.error
  if (userResult.error) throw userResult.error
  const docs = docResult.count ?? 0
  const users = userResult.count ?? 0
  if (users === 0) return 0
  return Math.round((docs / users) * 10) / 10
}
