import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { GoogleLogin, type CredentialResponse } from '@react-oauth/google'
import { jwtDecode } from 'jwt-decode'
import { useAuth } from '../hooks/useAuth'

interface GoogleJwtPayload {
  email: string
  name: string
  picture: string
}

export function Login() {
  const { user, login } = useAuth()
  const [error, setError] = useState<string | null>(null)

  if (user) {
    return <Navigate to="/" replace />
  }

  const handleSuccess = (response: CredentialResponse) => {
    if (!response.credential) {
      setError('Login failed. Please try again.')
      return
    }

    try {
      const decoded = jwtDecode<GoogleJwtPayload>(response.credential)
      const adminEmail = import.meta.env.VITE_ADMIN_EMAIL

      if (decoded.email !== adminEmail) {
        setError('Access denied. This dashboard is restricted to the Evara admin.')
        return
      }

      login({
        email: decoded.email,
        name: decoded.name,
        picture: decoded.picture,
      })
    } catch {
      setError('Failed to process login. Please try again.')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-white to-slate-100 font-body px-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 p-8">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-brand-600 rounded-xl mb-4">
              <span className="text-2xl font-heading font-bold text-white">E</span>
            </div>
            <h1 className="text-2xl font-heading font-bold text-slate-900">Evara</h1>
            <p className="text-slate-500 mt-1 text-sm">Admin Dashboard</p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
              {error}
            </div>
          )}

          {/* Google Login */}
          <div className="flex justify-center">
            <GoogleLogin
              onSuccess={handleSuccess}
              onError={() => setError('Login failed. Please try again.')}
              shape="rectangular"
              size="large"
              theme="outline"
              text="signin_with"
              width="320"
            />
          </div>

          <p className="text-center text-xs text-slate-400 mt-6">
            Only authorized admins can access this dashboard.
          </p>
        </div>
      </div>
    </div>
  )
}
