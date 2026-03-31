'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import fetchWrapper from '@/lib/fetchWrapper'
import { clearAuthToken, getAuthToken } from '@/lib/apiClient'
import AuthScreen from './sections/AuthScreen'
import Sidebar, { ScreenType } from './sections/Sidebar'
import Dashboard, { SAMPLE_JOBS, type DashboardStats } from './sections/Dashboard'
import UploadScreen from './sections/UploadScreen'
import JobDetail from './sections/JobDetail'
import { HiSparkles } from 'react-icons/hi2'

const THEME_VARS = {
  '--background': '160 35% 96%',
  '--foreground': '160 35% 8%',
  '--card': '160 30% 99%',
  '--card-foreground': '160 35% 8%',
  '--primary': '160 85% 35%',
  '--primary-foreground': '0 0% 100%',
  '--secondary': '160 30% 93%',
  '--secondary-foreground': '160 35% 8%',
  '--accent': '45 95% 50%',
  '--accent-foreground': '160 35% 8%',
  '--destructive': '0 84% 60%',
  '--destructive-foreground': '0 0% 100%',
  '--muted': '160 25% 90%',
  '--muted-foreground': '160 25% 40%',
  '--border': '160 28% 88%',
  '--input': '160 25% 85%',
  '--ring': '160 85% 35%',
  '--radius': '0.875rem',
  '--sidebar-background': '160 35% 97%',
  '--sidebar-primary': '160 85% 35%',
} as React.CSSProperties

const JOBS_PAGE_SIZE = 5

/**
 * Max time the upload flow keeps polling GET /api/jobs/:id before giving up.
 * Enrichment can take hours (Apollo pagination + LinkedIn + Lyzr); 10 minutes was too short.
 */
const JOB_ENRICHMENT_POLL_MAX_MS = 8 * 60 * 60 * 1000

/** Browser console diagnostics for job API flows (POST create, GET list, GET by id, polling). */
function jobLog(message: string, meta?: Record<string, unknown>) {
  if (meta !== undefined) {
    console.info('[jobs]', message, meta)
  } else {
    console.info('[jobs]', message)
  }
}

interface JobData {
  _id: string
  filename: string
  status: string
  total_companies: number
  contacts_found: number
  contacts_filtered: number
  createdAt: string
  error?: string
  download_url?: string
}

interface EnrichedContact {
  organization_id: string
  firm_name: string
  firm_website_url: string
  full_name: string
  linkedin_profile: string
  linkedin_validation: string
  person_title: string
  official_email: string
  official_email_status: string
  personal_emails: string
  industry: string
  research_coverage: string
  geo: string
  analyst_firm_hq: string
}

function mapJobStatusToProcessingStage(status: string): { stage: number; label: string } {
  const normalizedStatus = (status || '').trim().toLowerCase()

  if (normalizedStatus === 'apollo fetching') {
    return { stage: 1, label: 'Apollo fetching contacts...' }
  }
  if (normalizedStatus === 'ai enrichment') {
    return { stage: 2, label: 'Running AI enrichment...' }
  }
  if (normalizedStatus === 'completed') {
    return { stage: 3, label: 'Complete!' }
  }

  // "processing" and unknown in-progress statuses default to Input Parsing.
  return { stage: 0, label: 'Parsing input...' }
}

function normalizeMaybeListToString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) {
    return value
      .map((v) => (v === null || v === undefined ? '' : String(v).trim()))
      .filter(Boolean)
      .join(', ')
  }
  if (typeof value === 'string') return value
  return String(value)
}

function mapContactDocToEnrichedContact(doc: any): EnrichedContact {
  const first = doc?.first_name ? String(doc.first_name).trim() : ''
  const last = doc?.last_name ? String(doc.last_name).trim() : ''
  const fullName = [first, last].filter(Boolean).join(' ')

  return {
    organization_id: String(doc?.organization_id ?? ''),
    firm_name: String(doc?.firm_name ?? ''),
    firm_website_url: String(doc?.firm_website_url ?? ''),
    full_name: fullName,
    linkedin_profile: String(doc?.linkedin_profile ?? ''),
    linkedin_validation: normalizeMaybeListToString(doc?.linkedin_validation),
    person_title: String(doc?.person_title ?? ''),
    official_email: String(doc?.official_email ?? ''),
    official_email_status: String(doc?.official_email_status ?? ''),
    personal_emails: normalizeMaybeListToString(doc?.personal_emails),
    industry: normalizeMaybeListToString(doc?.industry),
    research_coverage: normalizeMaybeListToString(doc?.research_coverage),
    geo: String(doc?.geo ?? ''),
    analyst_firm_hq: String(doc?.analyst_firm_hq ?? ''),
  }
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
          <div className="text-center p-8 max-w-md">
            <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
            <p className="text-muted-foreground mb-4 text-sm">{this.state.error}</p>
            <button onClick={() => this.setState({ hasError: false, error: '' })} className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm">Try again</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Page() {
  const [authLoading, setAuthLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const [screen, setScreen] = useState<ScreenType>('dashboard')
  const [jobs, setJobs] = useState<JobData[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobsPage, setJobsPage] = useState(1)
  const [jobsTotal, setJobsTotal] = useState(0)
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [selectedJob, setSelectedJob] = useState<JobData | null>(null)
  const [enrichedContacts, setEnrichedContacts] = useState<EnrichedContact[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [sampleMode, setSampleMode] = useState(false)
  const [jobsRefreshMode, setJobsRefreshMode] = useState<'auto' | 'manual'>('auto')
  const [refreshingJobId, setRefreshingJobId] = useState<string | null>(null)
  const [processingState, setProcessingState] = useState({
    active: false,
    stage: 0,
    stageLabel: '',
    error: null as string | null,
  })
  const processingDismissedRef = useRef(false)

  const fetchJobsForPage = useCallback(async (page: number, opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent)
    if (!silent) setJobsLoading(true)
    jobLog('GET /api/jobs (list)', { page, page_size: JOBS_PAGE_SIZE, silent })
    try {
      const qs = new URLSearchParams({
        page: String(page),
        page_size: String(JOBS_PAGE_SIZE),
      })
      const res = await fetchWrapper(`/api/jobs?${qs}`)
      if (!res) {
        jobLog('GET /api/jobs aborted or no response', { page })
        return undefined
      }
      const data = await res.json()
      jobLog('GET /api/jobs response', {
        ok: data.success,
        status: res.status,
        total: data.total,
        rowCount: Array.isArray(data.data) ? data.data.length : 0,
      })
      if (data.success && Array.isArray(data.data)) {
        setJobs(data.data)
        setJobsTotal(typeof data.total === 'number' ? data.total : data.data.length)
        if (typeof data.page === 'number') setJobsPage(data.page)
        if (data.stats && typeof data.stats === 'object') {
          setDashboardStats({
            totalJobs: Number(data.stats.total_jobs) || 0,
            contactsEnriched: Number(data.stats.contacts_enriched) || 0,
            completedJobs: Number(data.stats.completed_jobs) || 0,
          })
        }
        return data.data as JobData[]
      }
    } catch (err) {
      console.warn('[jobs] GET /api/jobs failed', err)
    } finally {
      if (!silent) setJobsLoading(false)
    }
    return undefined
  }, [])

  useEffect(() => {
    if (sampleMode) return
    fetchJobsForPage(1)
  }, [sampleMode, fetchJobsForPage])

  useEffect(() => {
    if (screen !== 'dashboard' || sampleMode || jobsRefreshMode !== 'auto') return
    const id = window.setInterval(() => {
      fetchJobsForPage(jobsPage, { silent: true })
    }, 5000)
    return () => window.clearInterval(id)
  }, [screen, sampleMode, jobsRefreshMode, fetchJobsForPage, jobsPage])

  const refreshSingleJob = useCallback(async (jobId: string) => {
    setRefreshingJobId(jobId)
    jobLog('GET /api/jobs/:id (refresh row)', { jobId })
    try {
      const res = await fetchWrapper(`/api/jobs/${jobId}`)
      if (!res) {
        jobLog('GET /api/jobs/:id no response', { jobId })
        setRefreshingJobId(null)
        return
      }
      const data = await res.json()
      jobLog('GET /api/jobs/:id response', {
        jobId,
        ok: data.success,
        status: res.status,
        jobStatus: data.data?.status,
      })
      if (data.success && data.data) {
        const updated = data.data as JobData
        setJobs((prev) => prev.map((j) => (j._id === jobId ? { ...j, ...updated } : j)))
        setSelectedJob((cur) => (cur && cur._id === jobId ? { ...cur, ...updated } : cur))
      }
    } catch (err) {
      console.warn('[jobs] GET /api/jobs/:id refresh failed', { jobId, err })
    }
    setRefreshingJobId(null)
  }, [])

  const handleSelectJob = useCallback(async (jobId: string) => {
    setSelectedJobId(jobId)
    setScreen('job-detail')
    setDetailLoading(true)
    setEnrichedContacts([])
    setDownloadUrl(null)

    jobLog('GET /api/jobs/:id + contacts (job detail)', { jobId })
    try {
      const [jobRes, contactsRes] = await Promise.all([
        fetchWrapper(`/api/jobs/${jobId}`),
        fetchWrapper(`/api/contacts-enriched?job_id=${jobId}`),
      ])
      if (!jobRes || !contactsRes) {
        jobLog('job detail fetch missing response', { jobId, hasJob: !!jobRes, hasContacts: !!contactsRes })
        setDetailLoading(false)
        return
      }
      const jobData = await jobRes.json()
      const contactsData = await contactsRes.json()

      jobLog('GET /api/jobs/:id detail response', {
        jobId,
        ok: jobData.success,
        jobStatus: jobData.data?.status,
        contactsCount: Array.isArray(contactsData.data) ? contactsData.data.length : 0,
      })

      if (jobData.success) {
        setSelectedJob(jobData.data)
        setDownloadUrl(jobData.data?.download_url ?? null)
      }
      if (contactsData.success && Array.isArray(contactsData.data)) {
        setEnrichedContacts(contactsData.data.map(mapContactDocToEnrichedContact))
      }
    } catch (err) {
      console.warn('[jobs] job detail load failed', { jobId, err })
    }
    setDetailLoading(false)
  }, [])

  const refreshJobDetailSilently = useCallback(async () => {
    if (!selectedJobId) return
    try {
      const [jobRes, contactsRes] = await Promise.all([
        fetchWrapper(`/api/jobs/${selectedJobId}`),
        fetchWrapper(`/api/contacts-enriched?job_id=${selectedJobId}`),
      ])
      if (!jobRes || !contactsRes) return
      const jobData = await jobRes.json()
      const contactsData = await contactsRes.json()
      if (jobData.success && jobData.data) {
        setSelectedJob(jobData.data)
        setDownloadUrl(jobData.data?.download_url ?? null)
      }
      if (contactsData.success && Array.isArray(contactsData.data)) {
        setEnrichedContacts(contactsData.data.map(mapContactDocToEnrichedContact))
      }
    } catch (err) {
      console.warn('[jobs] silent job detail refresh failed', { jobId: selectedJobId, err })
    }
  }, [selectedJobId])

  const handleDeleteJob = useCallback(
    async (jobId: string) => {
      jobLog('DELETE /api/jobs/:id', { jobId })
      const res = await fetchWrapper(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' })
      if (!res) throw new Error('Network error')
      const data = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok) {
        const detail = data.detail
        const msg =
          typeof detail === 'string'
            ? detail
            : Array.isArray(detail)
              ? detail.map((d: { msg?: string }) => d?.msg || String(d)).join(', ')
              : `Failed to delete (${res.status})`
        throw new Error(msg)
      }
      if (selectedJobId === jobId) {
        setScreen('dashboard')
        setSelectedJobId(null)
        setSelectedJob(null)
        setEnrichedContacts([])
        setDownloadUrl(null)
      }
      const page = jobsPage
      const rows = await fetchJobsForPage(page, { silent: true })
      if (rows && rows.length === 0 && page > 1) {
        const prev = page - 1
        setJobsPage(prev)
        await fetchJobsForPage(prev, { silent: true })
      }
    },
    [fetchJobsForPage, jobsPage, selectedJobId],
  )

  const handleStartProcessing = useCallback(async (
    file: File,
    parsedData: any[],
    uploadedFilename: string,
  ) => {
    processingDismissedRef.current = false
    setProcessingState({ active: true, stage: 0, stageLabel: 'Creating job...', error: null })

    try {
      // Prefer name captured in UploadScreen on file pick — `File.name` is sometimes "" (Safari / some drag sources).
      const filename =
        (uploadedFilename && uploadedFilename.trim()) ||
        (file?.name && file.name.trim()) ||
        'upload'

      const jobBody = { filename, rows: parsedData }

      const jobsUrl = `/api/jobs?filename=${encodeURIComponent(filename)}`
      jobLog('POST /api/jobs (create)', {
        filename,
        rowCount: parsedData.length,
        url: jobsUrl,
      })
      const jobRes = await fetchWrapper(jobsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-upload-filename': filename,
        },
        body: JSON.stringify(jobBody),
      })
      if (!jobRes) throw new Error('Network error')
      const jobData = await jobRes.json()
      jobLog('POST /api/jobs response', {
        ok: jobData.success,
        status: jobRes.status,
        jobId: jobData.data?._id,
      })
      if (processingDismissedRef.current) return
      if (!jobData.success) {
        const detail = jobData.detail
        const msg =
          typeof detail === 'string'
            ? detail
            : Array.isArray(detail)
              ? detail.map((d: any) => d?.msg || d).join(', ')
              : jobData.error || 'Failed to create job'
        throw new Error(msg)
      }
      const jobId = jobData.data._id

      if (processingDismissedRef.current) return
      setProcessingState(p => ({ ...p, stage: 1, stageLabel: 'Enriching contacts (server)...' }))

      const pollStarted = Date.now()
      let pollIteration = 0
      let clientPollTimedOut = false
      while (true) {
        if (processingDismissedRef.current) return
        pollIteration += 1
        const elapsedMs = Date.now() - pollStarted
        const pollRes = await fetchWrapper(`/api/jobs/${jobId}`)
        if (!pollRes) throw new Error('Network error while polling job')
        const pollJson = await pollRes.json()
        if (!pollJson.success || !pollJson.data) throw new Error('Failed to poll job status')
        const st = pollJson.data.status
        if (pollIteration === 1 || pollIteration % 15 === 0 || st === 'completed' || st === 'failed') {
          jobLog('GET /api/jobs/:id (poll)', {
            jobId,
            iteration: pollIteration,
            elapsedMs,
            status: st,
            totalContacts: pollJson.data.total_contacts_enriched,
          })
        }
        const mapped = mapJobStatusToProcessingStage(st)
        setProcessingState(p => ({
          ...p,
          stage: mapped.stage,
          stageLabel: mapped.label,
        }))
        if (st === 'completed') break
        if (st === 'failed') {
          jobLog('poll saw failed status', { jobId, error: pollJson.data.error })
          throw new Error(pollJson.data.error || 'Processing failed')
        }
        if (elapsedMs >= JOB_ENRICHMENT_POLL_MAX_MS) {
          jobLog('poll timeout', {
            jobId,
            elapsedMs,
            maxMs: JOB_ENRICHMENT_POLL_MAX_MS,
            lastStatus: st,
          })
          clientPollTimedOut = true
          break
        }
        await new Promise(r => setTimeout(r, 2000))
      }

      if (clientPollTimedOut) {
        jobLog('client poll timeout: closing modal and showing dashboard jobs', { jobId })
        setProcessingState({ active: false, stage: 0, stageLabel: '', error: null })
        setScreen('dashboard')
        setSelectedJobId(null)
        setSelectedJob(null)
        setJobsPage(1)
        await fetchJobsForPage(1)
        return
      }

      if (processingDismissedRef.current) return
      setProcessingState(p => ({ ...p, stage: 3, stageLabel: 'Loading results...' }))

      const enrichedRes = await fetchWrapper(`/api/contacts-enriched?job_id=${jobId}`)
      if (!enrichedRes) throw new Error('Network error')
      const enrichedJson = await enrichedRes.json()
      if (!enrichedJson.success) {
        throw new Error(enrichedJson.error || 'Failed to load enriched contacts')
      }

      if (processingDismissedRef.current) return
      setProcessingState(p => ({ ...p, stage: 3, stageLabel: 'Complete!' }))

      setTimeout(() => {
        if (processingDismissedRef.current) return
        setProcessingState({ active: false, stage: 0, stageLabel: '', error: null })
        fetchJobsForPage(1)
        handleSelectJob(jobId)
      }, 1200)
    } catch (err: any) {
      if (processingDismissedRef.current) return
      setProcessingState(p => ({
        ...p,
        error: err?.message || 'Processing failed',
        stageLabel: 'Failed',
      }))
    }
  }, [fetchJobsForPage, handleSelectJob])

  useEffect(() => {
    if (!sampleMode) return
    setJobsTotal(SAMPLE_JOBS.length)
    setDashboardStats({
      totalJobs: SAMPLE_JOBS.length,
      contactsEnriched: SAMPLE_JOBS.reduce((sum, j) => sum + (j.contacts_filtered || 0), 0),
      completedJobs: SAMPLE_JOBS.filter((j) => j.status === 'completed').length,
    })
  }, [sampleMode])

  useEffect(() => {
    const initAuth = async () => {
      const token = getAuthToken()
      if (!token) {
        setAuthLoading(false)
        return
      }
      try {
        const res = await fetchWrapper('/api/auth/me')
        if (!res) {
          clearAuthToken()
          return
        }
        const data = await res.json()
        if (data.success && data.user) setUser(data.user)
        else clearAuthToken()
      } catch {
        clearAuthToken()
      } finally {
        setAuthLoading(false)
      }
    }
    initAuth()
  }, [])

  if (authLoading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>
  }

  if (!user) {
    return <AuthScreen onAuthSuccess={(u) => setUser(u)} />
  }

  return (
    <ErrorBoundary>
        <div style={THEME_VARS} className="min-h-screen bg-background text-foreground font-sans">
            <div className="flex h-screen overflow-hidden">
              <Sidebar currentScreen={screen} onNavigate={(s) => { setScreen(s); setSelectedJobId(null) }} />
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="h-14 border-b border-border bg-card/80 backdrop-blur-md flex items-center justify-between px-6 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <HiSparkles className="w-4 h-4 text-primary" />
                    <span className="text-sm font-medium text-foreground tracking-tight">Contact Enrichment</span>
                  </div>
                  <button
                    className="text-sm underline"
                    onClick={() => {
                      clearAuthToken()
                      setUser(null)
                    }}
                  >
                    Logout
                  </button>
                </div>
                <div className="flex-1 overflow-hidden flex flex-col" style={{ background: 'linear-gradient(135deg, hsl(160 40% 94%) 0%, hsl(180 35% 93%) 30%, hsl(160 35% 95%) 60%, hsl(140 40% 94%) 100%)' }}>
                  {screen === 'dashboard' && (
                    <Dashboard
                      jobs={jobs}
                      loading={jobsLoading}
                      onNavigateUpload={() => setScreen('upload')}
                      onSelectJob={handleSelectJob}
                      sampleMode={sampleMode}
                      onToggleSample={(v) => {
                        setSampleMode(v)
                        if (v) setJobsPage(1)
                      }}
                      jobsRefreshMode={jobsRefreshMode}
                      onJobsRefreshModeChange={setJobsRefreshMode}
                      onRefreshJob={refreshSingleJob}
                      refreshingJobId={refreshingJobId}
                      jobsPage={jobsPage}
                      jobsPageSize={JOBS_PAGE_SIZE}
                      jobsTotal={sampleMode ? SAMPLE_JOBS.length : jobsTotal}
                      onJobsPageChange={(p) => void fetchJobsForPage(p)}
                      dashboardStats={dashboardStats}
                      onDeleteJob={handleDeleteJob}
                    />
                  )}
                  {screen === 'upload' && (
                    <UploadScreen
                      onStartProcessing={handleStartProcessing}
                      onDismissProcessing={() => {
                        processingDismissedRef.current = true
                        setProcessingState({ active: false, stage: 0, stageLabel: '', error: null })
                      }}
                      processingState={processingState}
                      onBack={() => setScreen('dashboard')}
                    />
                  )}
                  {screen === 'job-detail' && (
                    <JobDetail
                      job={selectedJob}
                      enrichedContacts={enrichedContacts}
                      loading={detailLoading}
                      downloadUrl={downloadUrl}
                      rerunEnrichmentEnabled={!sampleMode}
                      onRerunEnrichmentSuccess={refreshJobDetailSilently}
                      onBack={() => {
                        setScreen('dashboard')
                        setSelectedJobId(null)
                        if (!sampleMode) fetchJobsForPage(jobsPage)
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
        </div>
    </ErrorBoundary>
  )
}
