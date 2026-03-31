'use client'

import React, { useState, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Loader2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { HiCloudArrowUp, HiDocumentText, HiXMark, HiCheckCircle, HiExclamationTriangle } from 'react-icons/hi2'

interface ParsedRow {
  name?: string
  title?: string
  email?: string
  linkedin_url?: string
  company?: string
  domain?: string
  location?: string
  [key: string]: string | undefined
}

interface UploadScreenProps {
  /** uploadedFilename is captured when the file is chosen (some browsers leave File.name empty later). */
  onStartProcessing: (file: File, parsedData: ParsedRow[], uploadedFilename: string) => void
  onDismissProcessing: () => void
  processingState: {
    active: boolean
    stage: number
    stageLabel: string
    error: string | null
  }
  onBack: () => void
}

const STAGES = [
  'Input Parsing',
  'Apollo Fetching',
  'AI Enrichment',
  'Complete',
]

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

function parseCSV(text: string): ParsedRow[] {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'))
  const rows: ParsedRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCSVLine(lines[i])
    const row: ParsedRow = {}
    headers.forEach((h, idx) => {
      row[h] = vals[idx] || ''
    })
    rows.push(row)
  }
  return rows
}

function normalizeHeaders(input: string): string {
  return input.toLowerCase().trim().replace(/\s+/g, '_')
}

function parseExcel(buffer: ArrayBuffer): ParsedRow[] {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) return []
  const firstSheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '' })
  return rows.map((row) => {
    const normalized: ParsedRow = {}
    Object.entries(row).forEach(([key, value]) => {
      normalized[normalizeHeaders(key)] = String(value ?? '')
    })
    return normalized
  })
}

export default function UploadScreen({ onStartProcessing, onDismissProcessing, processingState, onBack }: UploadScreenProps) {
  const [file, setFile] = useState<File | null>(null)
  /** Snapshot of name at selection time — `file.name` can be "" on some platforms. */
  const [uploadedFileLabel, setUploadedFileLabel] = useState('')
  const [parsedData, setParsedData] = useState<ParsedRow[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback((f: File) => {
    setParseError(null)
    const ext = f.name.split('.').pop()?.toLowerCase()
    if (ext !== 'csv' && ext !== 'xlsx' && ext !== 'xls') {
      setParseError('Please upload a .csv or .xlsx file')
      return
    }
    const trimmed = (f.name || '').trim()
    const fallbackName =
      trimmed ||
      (ext === 'csv' ? 'upload.csv' : ext === 'xlsx' ? 'upload.xlsx' : 'upload.xls')
    setUploadedFileLabel(fallbackName)
    setFile(f)

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        let rows: ParsedRow[] = []
        if (ext === 'csv') {
          const text = e.target?.result as string
          rows = parseCSV(text)
        } else {
          const buffer = e.target?.result as ArrayBuffer
          rows = parseExcel(buffer)
        }
        if (rows.length === 0) {
          setParseError('No data rows found in file. Please upload a valid CSV/XLSX with headers.')
          return
        }
        setParsedData(rows)
      } catch {
        setParseError('Failed to parse file. Please ensure it is a valid CSV/XLSX.')
      }
    }
    if (ext === 'csv') {
      reader.readAsText(f)
    } else {
      reader.readAsArrayBuffer(f)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const clearFile = () => {
    setFile(null)
    setUploadedFileLabel('')
    setParsedData([])
    setParseError(null)
  }

  if (processingState.active) {
    return (
      <div className="flex-1 p-6 flex items-center justify-center">
        <Card className="w-full max-w-lg border-border bg-card/70 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 shrink-0" aria-hidden />
              <CardTitle className="flex-1 text-base font-semibold text-center">Processing Contacts</CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={onDismissProcessing}
                aria-label="Close and return to upload"
              >
                <HiXMark className="h-5 w-5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-3">
              {STAGES.map((stage, idx) => {
                const isComplete = processingState.stage > idx
                const isCurrent = processingState.stage === idx
                return (
                  <div key={stage} className="flex items-center gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold ${isComplete ? 'bg-primary text-primary-foreground' : isCurrent ? 'bg-primary/20 text-primary border-2 border-primary' : 'bg-muted text-muted-foreground'}`}>
                      {isComplete ? <HiCheckCircle className="w-4 h-4" /> : idx + 1}
                    </div>
                    <span className={`text-sm ${isCurrent ? 'font-medium text-foreground' : isComplete ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {stage}
                    </span>
                    {isCurrent && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary ml-auto" />}
                  </div>
                )
              })}
            </div>
            <Progress value={(processingState.stage / STAGES.length) * 100} className="h-2" />
            <p className="text-xs text-center text-muted-foreground">{processingState.stageLabel}</p>
            {processingState.error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                <HiExclamationTriangle className="w-4 h-4 flex-shrink-0" />
                {processingState.error}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground tracking-tight">Upload Contacts</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Upload a CSV or Excel file with company URLs or contact data</p>
        </div>
        <Button variant="outline" onClick={onBack}>Back to Dashboard</Button>
      </div>

      <Card className="border-border bg-card/70 backdrop-blur-sm">
        <CardContent className="pt-6">
          {!file ? (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-200 ${dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-secondary/30'}`}
            >
              <HiCloudArrowUp className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
              <p className="text-sm font-medium text-foreground">Drop your file here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">Supports CSV, XLSX, and XLS</p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
                className="hidden"
              />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50 border border-border">
                <HiDocumentText className="w-8 h-8 text-primary flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{uploadedFileLabel || file.name || 'upload'}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB &middot; {parsedData.length} rows parsed</p>
                </div>
                <Button variant="ghost" size="sm" onClick={clearFile}>
                  <HiXMark className="w-4 h-4" />
                </Button>
              </div>
              {parseError && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
                  <HiExclamationTriangle className="w-4 h-4 flex-shrink-0" />
                  {parseError}
                </div>
              )}
              {parsedData.length > 0 && (
                <>
                  <div className="text-xs text-muted-foreground">
                    Preview (all {parsedData.length} rows):
                  </div>
                  <div className="max-h-[min(60vh,28rem)] overflow-auto border border-border rounded-lg">
                    <table className="w-max min-w-full text-xs">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b border-border bg-muted/95 backdrop-blur-sm">
                          {(Object.keys(parsedData[0] || {})).map(h => (
                            <th key={h} className="text-left p-2 font-medium text-muted-foreground whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsedData.map((row, i) => (
                          <tr key={i} className="border-b border-border/50">
                            {(Object.keys(parsedData[0] || {})).map(h => (
                              <td key={h} className="p-2 text-foreground max-w-[220px] truncate align-top" title={row[h] ?? ''}>{row[h] ?? ''}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Button
                    className="w-full gap-2"
                    onClick={() => onStartProcessing(file, parsedData, uploadedFileLabel)}
                    disabled={parsedData.length === 0}
                  >
                    <HiCheckCircle className="w-4 h-4" />
                    Start Processing ({parsedData.length} contacts)
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
