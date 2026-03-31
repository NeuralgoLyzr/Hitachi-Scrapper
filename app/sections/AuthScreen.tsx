'use client'

import React, { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { HiSparkles } from 'react-icons/hi2'
import fetchWrapper from '@/lib/fetchWrapper'
import { setAuthToken } from '@/lib/apiClient'

type Props = {
  onAuthSuccess: (user: any) => void
}

export default function AuthScreen({ onAuthSuccess }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const payload = mode === 'login' ? { email, password } : { email, password, name }
      const response = await fetchWrapper(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response) throw new Error('Network error')
      const data = await response.json()
      if (!response.ok || !data.success || !data.token) {
        throw new Error(data.detail || data.error || 'Authentication failed')
      }
      setAuthToken(data.token)
      onAuthSuccess(data.user)
    } catch (err: any) {
      setError(err?.message || 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-teal-50 to-green-50 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
              <HiSparkles className="w-5 h-5 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Contact Enrichment</h1>
          </div>
          <p className="text-sm text-muted-foreground">Analyst & Researcher Contact Enrichment Platform</p>
        </div>
        <Card className="border-border shadow-xl">
          <CardContent className="pt-6">
            <form className="space-y-4" onSubmit={handleSubmit}>
              {mode === 'register' && (
                <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
              )}
              <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button className="w-full" type="submit" disabled={loading}>
                {loading ? 'Please wait...' : mode === 'login' ? 'Login' : 'Register'}
              </Button>
              <button
                className="text-xs text-muted-foreground underline"
                type="button"
                onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
              >
                {mode === 'login' ? 'Need an account? Register' : 'Already have an account? Login'}
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
