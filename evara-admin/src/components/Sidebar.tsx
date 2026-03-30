import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import {
  BarChart3,
  Users,
  FileText,
  Bell,
  Search,
  DollarSign,
  Megaphone,
  LogOut,
  X,
} from 'lucide-react'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

const navItems = [
  { to: '/', icon: BarChart3, label: 'Dashboard', active: true },
  { to: '/users', icon: Users, label: 'Users', active: false },
  { to: '/documents', icon: FileText, label: 'Documents', active: false },
  { to: '/reminders', icon: Bell, label: 'Reminders', active: false },
  { to: '/search-analytics', icon: Search, label: 'Search Analytics', active: false },
  { to: '/revenue', icon: DollarSign, label: 'Revenue', active: false },
  { to: '#', icon: Megaphone, label: 'Broadcast', active: false },
]

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-sidebar flex flex-col transition-transform duration-200 lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-700/50">
          <div>
            <h1 className="text-xl font-heading font-bold text-white">Evara</h1>
            <p className="text-xs text-slate-400 mt-0.5">Admin Dashboard</p>
          </div>
          <button onClick={onClose} className="lg:hidden text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map(item => {
            const Icon = item.icon
            if (!item.active) {
              return (
                <div
                  key={item.label}
                  className="group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-slate-500 cursor-not-allowed"
                  title="Coming Soon"
                >
                  <Icon size={20} />
                  <span className="text-sm font-medium">{item.label}</span>
                  <span className="ml-auto text-[10px] bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded">
                    Soon
                  </span>
                </div>
              )
            }
            return (
              <NavLink
                key={item.label}
                to={item.to}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-brand-600 text-white'
                      : 'text-slate-300 hover:bg-sidebar-hover hover:text-white'
                  }`
                }
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-slate-700/50">
          <div className="flex items-center gap-3 mb-3 px-2">
            {user?.picture && (
              <img src={user.picture} alt="" className="w-8 h-8 rounded-full" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <p className="text-xs text-slate-400 truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-sidebar-hover hover:text-white transition-colors"
          >
            <LogOut size={18} />
            <span>Logout</span>
          </button>
        </div>
      </aside>
    </>
  )
}
