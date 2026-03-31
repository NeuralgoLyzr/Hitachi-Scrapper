'use client'

import React, { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { Eye, Globe, Info, Linkedin, Loader2, CheckCircle2, XCircle, Download, RotateCw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import fetchWrapper from '@/lib/fetchWrapper'
import { HiArrowLeft, HiMagnifyingGlass, HiDocumentArrowDown } from 'react-icons/hi2'
import * as XLSX from 'xlsx'

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

interface JobData {
  _id: string
  filename: string
  status: string
  total_companies: number
  contacts_found: number
  contacts_filtered: number
  createdAt: string
}

interface JobDetailProps {
  job: JobData | null
  enrichedContacts: EnrichedContact[]
  loading: boolean
  downloadUrl: string | null
  onBack: () => void
  /** When false (e.g. sample dashboard jobs), hide rerun enrichment control. */
  rerunEnrichmentEnabled?: boolean
  /** Called after a successful POST /jobs/ai_enrichment so the parent can refresh job + contacts. */
  onRerunEnrichmentSuccess?: () => void | Promise<void>
}

function statusColor(status: string) {
  switch (status) {
    case 'queued': return 'bg-yellow-100 text-yellow-700 border-yellow-200'
    case 'processing': return 'bg-blue-100 text-blue-700 border-blue-200'
    case 'completed': return 'bg-emerald-100 text-emerald-700 border-emerald-200'
    case 'failed': return 'bg-red-100 text-red-700 border-red-200'
    default: return 'bg-muted text-muted-foreground'
  }
}

export default function JobDetail({
  job,
  enrichedContacts,
  loading,
  downloadUrl,
  onBack,
  rerunEnrichmentEnabled = true,
  onRerunEnrichmentSuccess,
}: JobDetailProps) {
  const [search, setSearch] = useState('')
  const [rerunDialogOpen, setRerunDialogOpen] = useState(false)
  const [rerunSubmitting, setRerunSubmitting] = useState(false)
  const [rerunError, setRerunError] = useState<string | null>(null)

  const openRerunDialog = () => {
    setRerunError(null)
    setRerunDialogOpen(true)
  }

  const confirmRerunEnrichment = async () => {
    if (!job) return
    setRerunSubmitting(true)
    setRerunError(null)
    try {
      const res = await fetchWrapper('/api/jobs/ai_enrichment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job._id }),
      })
      if (!res) throw new Error('Network error')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = (data as { detail?: unknown }).detail
        const msg =
          typeof detail === 'string'
            ? detail
            : Array.isArray(detail)
              ? detail.map((d: { msg?: string }) => d?.msg || String(d)).join(', ')
              : (data as { error?: string }).error || `Request failed (${res.status})`
        throw new Error(msg)
      }
      if (!(data as { success?: boolean }).success) {
        throw new Error((data as { error?: string }).error || 'Request failed')
      }
      setRerunDialogOpen(false)
      await onRerunEnrichmentSuccess?.()
    } catch (e: unknown) {
      setRerunError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setRerunSubmitting(false)
    }
  }

  const isLinkedInValid = (v: string) => {
    const s = (v || '').toLowerCase().trim()
    return s === 'valid' || (s.includes('valid') && !s.includes('invalid'))
  }

  const renderEmailVerifiedIcon = (status: string) => {
    const s = (status || '').toLowerCase().trim()
    if (!s) return null
    // Important: handle "unverified" first, because it also contains substring "verified".
    if (s.includes('unverified') || s.includes('not verified') || s.includes('invalid')) {
      return (
        <span aria-label={`Official email: ${status}`} role="img">
          <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
        </span>
      )
    }
    if (s.includes('verified')) {
      return (
        <span aria-label="Official email verified" role="img">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
        </span>
      )
    }
    return (
      <span aria-label={`Official email: ${status}`} role="img">
        <Info className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      </span>
    )
  }

  const downloadFilteredToXlsx = () => {
    if (!job) return
    if (!Array.isArray(filtered) || filtered.length === 0) return

    const exportRows = filtered.map((c) => ({
      Company: c.firm_name || '',
      'Company Website': c.firm_website_url || '',
      'Organization ID': c.organization_id || '',
      'Full Name': c.full_name || '',
      Title: c.person_title || '',
      'Official Email': c.official_email || '',
      'Official Email Status': c.official_email_status || '',
      'Personal Emails': c.personal_emails || '',
      'LinkedIn Profile': c.linkedin_profile || '',
      'LinkedIn Validation': c.linkedin_validation || '',
      Industry: c.industry || '',
      'Research Coverage': c.research_coverage || '',
      Geo: c.geo || '',
      'Analyst HQ': c.analyst_firm_hq || '',
    }))

    const worksheet = XLSX.utils.json_to_sheet(exportRows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Enriched Contacts')

    const safeBaseName = (job.filename || 'enriched-contacts')
      .toString()
      .replace(/[^a-z0-9-_]+/gi, '_')
      .replace(/^_+|_+$/g, '')
    const filename = `${safeBaseName}-contacts.xlsx`

    const wbout = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const filtered = useMemo(() => {
    const contacts = Array.isArray(enrichedContacts) ? enrichedContacts : []
    let list = contacts
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((c) => {
        const haystack = [
          c.organization_id,
          c.firm_name,
          c.firm_website_url,
          c.full_name,
          c.linkedin_profile,
          c.linkedin_validation,
          c.person_title,
          c.official_email,
          c.official_email_status,
          c.personal_emails,
          c.industry,
          c.research_coverage,
          c.geo,
          c.analyst_firm_hq,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(q)
      })
    }
    // Don't slice: let the ScrollArea handle pagination via scrolling.
    return list
  }, [enrichedContacts, search])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-2 text-sm text-muted-foreground">Loading job details...</span>
      </div>
    )
  }

  if (!job) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">Job not found</p>
          <Button variant="outline" className="mt-3" onClick={onBack}>Back to Dashboard</Button>
        </div>
      </div>
    )
  }

  const totalEnriched = Array.isArray(enrichedContacts) ? enrichedContacts.length : 0

  return (
    <div className="flex-1 p-6 space-y-5 overflow-y-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <HiArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-foreground tracking-tight truncate">{job.filename}</h2>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0 flex-wrap justify-end">
          <span className={`text-xs px-3 py-1.5 rounded-full border font-medium ${statusColor(job.status)}`}>
            {job.status}
          </span>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Created {new Date(job.createdAt).toLocaleString()}
          </span>
          {rerunEnrichmentEnabled && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={openRerunDialog}
              aria-label="Rerun AI enrichment for missing fields"
              title="Rerun AI enrichment"
            >
              <RotateCw className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <Dialog
        open={rerunDialogOpen}
        onOpenChange={(open) => {
          setRerunDialogOpen(open)
          if (!open) setRerunError(null)
        }}
      >
        <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => rerunSubmitting && e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Rerun AI enrichment?</DialogTitle>
            <DialogDescription>
              This will queue another run to fill research coverage and related fields for contacts that are still
              missing data for this job.
            </DialogDescription>
          </DialogHeader>
          {rerunError ? <p className="text-sm text-destructive">{rerunError}</p> : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" disabled={rerunSubmitting} onClick={() => setRerunDialogOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={rerunSubmitting} onClick={() => void confirmRerunEnrichment()}>
              {rerunSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Starting…
                </>
              ) : (
                'Yes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Companies', value: job.total_companies },
          { label: 'Contacts Found', value: job.contacts_found },
          { label: 'Enriched', value: totalEnriched },
          { label: 'Filtered', value: job.contacts_filtered },
        ].map(s => (
          <Card key={s.label} className="border-border bg-card/70">
            <CardContent className="pt-4 pb-3 px-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-semibold text-foreground mt-0.5">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {job.status === 'processing' && (
        <Card className="border-border bg-card/70">
          <CardContent className="py-4 px-5">
            <p className="text-sm font-medium text-foreground mb-2">Processing in progress...</p>
            <Progress value={50} className="h-2" />
          </CardContent>
        </Card>
      )}

      <Card className="border-border bg-card/70 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">Enriched Contacts</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <HiMagnifyingGlass className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search contacts..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-8 w-56 text-xs"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={downloadFilteredToXlsx}
                disabled={totalEnriched === 0 || filtered.length === 0}
                aria-label="Download contacts as XLSX"
                title="Download XLSX file"
              >
                <Download className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {totalEnriched === 0 ? (
            <div className="text-center py-10">
              <p className="text-sm text-muted-foreground">
                {job.status === 'completed' ? 'No enriched contacts found.' : 'Contacts will appear here once processing completes.'}
              </p>
            </div>
          ) : (
            <div className="h-[360px] overflow-y-auto overflow-x-auto">
              <div className="min-w-max">
                <table className="min-w-max text-xs">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b border-border">
                    <th className="text-left p-2.5 font-medium text-muted-foreground">Company</th>
                    <th className="text-left p-2.5 font-medium text-muted-foreground">Contact</th>
                    <th className="text-left p-2.5 font-medium text-muted-foreground">Title</th>
                    <th className="text-left p-2.5 font-medium text-muted-foreground">Official Email</th>
                    <th className="text-left p-2.5 font-medium text-muted-foreground">Personal Emails</th>
                    <th className="text-left p-2.5 font-medium text-muted-foreground">LinkedIn</th>
                    <th className="text-left p-2.5 font-medium text-muted-foreground">Industry</th>
                    <th className="text-left p-2.5 font-medium text-muted-foreground">Research Coverage</th>
                    <th className="text-left p-2.5 font-medium text-muted-foreground">Geo</th>
                    <th className="text-left p-2.5 font-medium text-muted-foreground">Analyst HQ</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, i) => (
                    <tr key={i} className="border-b border-border/50 hover:bg-secondary/30 transition-colors">
                      <td className="p-2.5 font-medium text-foreground whitespace-nowrap">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">{c.firm_name || '-'}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            {c.firm_website_url ? (
                              <a
                                href={c.firm_website_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Open company website"
                                title={c.firm_website_url}
                                className="text-primary hover:opacity-80"
                              >
                                <Globe className="w-4 h-4" />
                              </a>
                            ) : null}
                            {c.organization_id ? (
                              <span
                                aria-label="Organization id"
                                title={c.organization_id}
                                className="text-muted-foreground cursor-help"
                              >
                                <Eye className="w-4 h-4" />
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="p-2.5 text-foreground whitespace-nowrap">{c.full_name || '-'}</td>
                      <td className="p-2.5 text-muted-foreground max-w-[140px] truncate">{c.person_title || '-'}</td>
                      <td className="p-2.5 text-primary max-w-[160px] truncate">
                        {c.official_email ? (
                          <div className="flex items-center gap-2">
                            <a href={`mailto:${c.official_email}`} className="hover:underline truncate">
                              {c.official_email}
                            </a>
                            {renderEmailVerifiedIcon(c.official_email_status)}
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="p-2.5 text-muted-foreground max-w-[160px] truncate">{c.personal_emails || '-'}</td>
                      <td className="p-2.5">
                        {c.linkedin_profile ? (
                          <div className="flex items-center gap-2">
                            <a
                              href={c.linkedin_profile}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label="Open LinkedIn profile"
                              title={c.linkedin_profile}
                              className="text-primary hover:opacity-80"
                            >
                              <Linkedin className="w-4 h-4" />
                            </a>
                            {c.linkedin_validation && isLinkedInValid(c.linkedin_validation) ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" aria-label="LinkedIn valid" />
                            ) : null}
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="p-2.5 max-w-[280px] whitespace-normal break-words">
                        {c.industry ? (
                          <span className="px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">{c.industry}</span>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="p-2.5 text-muted-foreground max-w-[280px] whitespace-normal break-words">{c.research_coverage || '-'}</td>
                      <td className="p-2.5 text-muted-foreground max-w-[140px] truncate">{c.geo || '-'}</td>
                      <td className="p-2.5 text-muted-foreground max-w-[140px] truncate">{c.analyst_firm_hq || '-'}</td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
