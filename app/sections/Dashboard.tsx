'use client'

import React, { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { HiBriefcase, HiUsers, HiChartBar, HiCloudArrowUp, HiDocumentText } from 'react-icons/hi2'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface Job {
  _id: string
  filename: string
  status: string
  total_companies: number
  contacts_found: number
  contacts_filtered: number
  createdAt: string
}

export interface DashboardStats {
  totalJobs: number
  contactsEnriched: number
  completedJobs: number
}

interface DashboardProps {
  jobs: Job[]
  loading: boolean
  onNavigateUpload: () => void
  onSelectJob: (jobId: string) => void
  sampleMode: boolean
  onToggleSample: (v: boolean) => void
  jobsRefreshMode: 'auto' | 'manual'
  onJobsRefreshModeChange: (mode: 'auto' | 'manual') => void
  onRefreshJob: (jobId: string) => void
  refreshingJobId: string | null
  jobsPage: number
  jobsPageSize: number
  jobsTotal: number
  onJobsPageChange: (page: number) => void
  dashboardStats: DashboardStats | null
  onDeleteJob: (jobId: string) => Promise<void>
}

export const SAMPLE_JOBS: Job[] = [
  { _id: 's1', filename: 'tech_companies_q1.xlsx', status: 'completed', total_companies: 45, contacts_found: 312, contacts_filtered: 198, createdAt: '2026-03-18T10:30:00Z' },
  { _id: 's2', filename: 'healthcare_leads.xlsx', status: 'processing', total_companies: 28, contacts_found: 156, contacts_filtered: 0, createdAt: '2026-03-19T14:20:00Z' },
  { _id: 's3', filename: 'fintech_startups.xlsx', status: 'completed', total_companies: 62, contacts_found: 420, contacts_filtered: 287, createdAt: '2026-03-17T09:00:00Z' },
  { _id: 's4', filename: 'saas_companies_feb.xlsx', status: 'failed', total_companies: 15, contacts_found: 0, contacts_filtered: 0, createdAt: '2026-03-16T16:45:00Z' },
]

function statusColor(status: string) {
  switch (status) {
    case 'queued': return 'bg-yellow-100 text-yellow-700 border-yellow-200'
    case 'processing': return 'bg-blue-100 text-blue-700 border-blue-200'
    case 'completed': return 'bg-emerald-100 text-emerald-700 border-emerald-200'
    case 'failed': return 'bg-red-100 text-red-700 border-red-200'
    default: return 'bg-muted text-muted-foreground'
  }
}

/** e.g. current 5 of 67 → [1, 'ellipsis', 4, 5, 6, 'ellipsis', 67] */
function buildPaginationItems(current: number, lastPage: number): (number | 'ellipsis')[] {
  if (lastPage <= 1) return lastPage === 1 ? [1] : []
  if (lastPage <= 7) {
    return Array.from({ length: lastPage }, (_, i) => i + 1)
  }
  const pages = new Set<number>()
  pages.add(1)
  pages.add(lastPage)
  for (let p = current - 1; p <= current + 1; p++) {
    if (p >= 1 && p <= lastPage) pages.add(p)
  }
  const sorted = Array.from(pages).sort((a, b) => a - b)
  const out: (number | 'ellipsis')[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push('ellipsis')
    out.push(sorted[i])
  }
  return out
}

export default function Dashboard({
  jobs,
  loading,
  onNavigateUpload,
  onSelectJob,
  sampleMode,
  onToggleSample,
  jobsRefreshMode,
  onJobsRefreshModeChange,
  onRefreshJob,
  refreshingJobId,
  jobsPage,
  jobsPageSize,
  jobsTotal,
  onJobsPageChange,
  dashboardStats,
  onDeleteJob,
}: DashboardProps) {
  const [jobPendingDelete, setJobPendingDelete] = useState<Job | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const displayJobs = sampleMode
    ? SAMPLE_JOBS.slice((jobsPage - 1) * jobsPageSize, jobsPage * jobsPageSize)
    : jobs
  const showPerJobRefresh = !sampleMode && jobsRefreshMode === 'manual'
  const showDeleteJob = !sampleMode

  const statsSource = sampleMode
    ? {
        totalJobs: SAMPLE_JOBS.length,
        contactsEnriched: SAMPLE_JOBS.reduce((sum, j) => sum + (j.contacts_filtered || 0), 0),
        completedJobs: SAMPLE_JOBS.filter((j) => j.status === 'completed').length,
      }
    : dashboardStats
  const totalJobs = statsSource?.totalJobs ?? 0
  const totalEnriched = statsSource?.contactsEnriched ?? 0
  const completedJobs = statsSource?.completedJobs ?? 0
  const successRate = totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0

  const totalPages = Math.max(1, Math.ceil(jobsTotal / jobsPageSize))
  const showPagination = jobsTotal > 0 && totalPages > 1
  const paginationItems = useMemo(
    () => buildPaginationItems(jobsPage, totalPages),
    [jobsPage, totalPages],
  )

  const stats = [
    { label: 'Total Jobs', value: totalJobs, icon: HiBriefcase, color: 'text-primary' },
    { label: 'Contacts Enriched', value: totalEnriched, icon: HiUsers, color: 'text-emerald-600' },
    { label: 'Success Rate', value: `${successRate}%`, icon: HiChartBar, color: 'text-teal-600' },
  ]

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Overview of your enrichment jobs</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="sample-toggle" checked={sampleMode} onCheckedChange={onToggleSample} />
            <Label htmlFor="sample-toggle" className="text-xs text-muted-foreground">Sample Data</Label>
          </div>
          <Button onClick={onNavigateUpload} className="gap-2">
            <HiCloudArrowUp className="w-4 h-4" />
            New Upload
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="border-border bg-card/70 backdrop-blur-sm">
            <CardContent className="pt-5 pb-4 px-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</p>
                  <p className="text-2xl font-semibold text-foreground mt-1">{stat.value}</p>
                </div>
                <div className={`p-2.5 rounded-xl bg-secondary ${stat.color}`}>
                  <stat.icon className="w-5 h-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-border bg-card/70 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base font-semibold">Recent Jobs</CardTitle>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide hidden sm:inline">
                Refresh
              </span>
              <ToggleGroup
                type="single"
                value={jobsRefreshMode}
                onValueChange={(v) => {
                  if (v) onJobsRefreshModeChange(v as 'auto' | 'manual')
                }}
                disabled={sampleMode}
                variant="outline"
                size="sm"
                className="border border-border rounded-lg p-0.5 bg-background/80"
              >
                <ToggleGroupItem value="auto" className="text-xs px-2.5 h-8 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  Auto
                </ToggleGroupItem>
                <ToggleGroupItem value="manual" className="text-xs px-2.5 h-8 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                  Manual
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <span className="ml-2 text-sm text-muted-foreground">Loading jobs...</span>
            </div>
          ) : displayJobs.length === 0 ? (
            <div className="text-center py-12">
              <HiDocumentText className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No jobs yet. Upload a file to get started.</p>
              <Button variant="outline" className="mt-4" onClick={onNavigateUpload}>
                <HiCloudArrowUp className="w-4 h-4 mr-2" />
                Upload File
              </Button>
            </div>
          ) : (
            <ScrollArea className="max-h-[400px]">
              <div className="space-y-2">
                {displayJobs.map((job) => (
                  <div
                    key={job._id}
                    className="flex items-stretch rounded-xl border border-border bg-background/50 hover:bg-secondary/50 transition-all duration-200 group overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectJob(job._id)}
                      className="flex-1 min-w-0 flex items-center gap-4 p-3.5 text-left"
                    >
                      <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                        <HiDocumentText className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{job.filename}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {job.total_companies} companies &middot; {job.contacts_found} contacts found
                        </p>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${statusColor(job.status)}`}>
                          {job.status}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(job.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </button>
                    {showPerJobRefresh && (
                      <div className="flex items-center border-l border-border pl-1 pr-1.5 bg-background/30">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            onRefreshJob(job._id)
                          }}
                          disabled={refreshingJobId === job._id}
                          aria-label={`Refresh status for ${job.filename}`}
                        >
                          <RefreshCw
                            className={cn(
                              'h-4 w-4',
                              refreshingJobId === job._id && 'animate-spin',
                            )}
                          />
                        </Button>
                      </div>
                    )}
                    {showDeleteJob && (
                      <div className="flex items-center border-l border-border pl-1 pr-1.5 bg-background/30">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setDeleteError(null)
                            setJobPendingDelete(job)
                          }}
                          aria-label={`Delete job ${job.filename}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
          {showPagination && !loading && displayJobs.length > 0 && (
            <div className="flex flex-col items-center gap-2 pt-5 mt-1 border-t border-border">
              <div
                className="flex flex-wrap justify-center items-center gap-1 max-w-full"
                role="navigation"
                aria-label="Job list pages"
              >
                {paginationItems.map((item, idx) =>
                  item === 'ellipsis' ? (
                    <span
                      key={`e-${idx}`}
                      className="px-1.5 text-xs text-muted-foreground select-none"
                      aria-hidden
                    >
                      …
                    </span>
                  ) : (
                    <Button
                      key={item}
                      type="button"
                      variant={jobsPage === item ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 min-w-8 px-2.5 tabular-nums"
                      onClick={() => {
                        if (item !== jobsPage) onJobsPageChange(item)
                      }}
                      aria-label={`Page ${item}`}
                      aria-current={jobsPage === item ? 'page' : undefined}
                    >
                      {item}
                    </Button>
                  ),
                )}
              </div>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {jobsTotal} job{jobsTotal === 1 ? '' : 's'} total
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={jobPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setJobPendingDelete(null)
            setDeleteError(null)
            setDeleteSubmitting(false)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this job?</AlertDialogTitle>
            <AlertDialogDescription>
              {jobPendingDelete ? (
                <>
                  This will permanently remove <span className="font-medium text-foreground">{jobPendingDelete.filename}</span> and all
                  associated contacts. This cannot be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <p className="text-sm text-destructive" role="alert">
              {deleteError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSubmitting}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteSubmitting || !jobPendingDelete}
              onClick={async () => {
                if (!jobPendingDelete) return
                setDeleteSubmitting(true)
                setDeleteError(null)
                try {
                  await onDeleteJob(jobPendingDelete._id)
                  setJobPendingDelete(null)
                } catch (err) {
                  setDeleteError(err instanceof Error ? err.message : 'Failed to delete job')
                } finally {
                  setDeleteSubmitting(false)
                }
              }}
            >
              {deleteSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                'Delete job'
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
