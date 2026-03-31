'use client'

import React from 'react'
import { HiHome, HiCloudArrowUp, HiClock, HiSparkles } from 'react-icons/hi2'

export type ScreenType = 'dashboard' | 'upload' | 'job-detail'

interface SidebarProps {
  currentScreen: ScreenType
  onNavigate: (screen: ScreenType) => void
}

export default function Sidebar({ currentScreen, onNavigate }: SidebarProps) {
  const navItems = [
    { id: 'dashboard' as ScreenType, label: 'Dashboard', icon: HiHome },
    { id: 'upload' as ScreenType, label: 'New Upload', icon: HiCloudArrowUp },
  ]

  return (
    <div className="w-56 h-full border-r border-border bg-card/80 backdrop-blur-md flex flex-col">
      <div className="p-5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <HiSparkles className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground tracking-tight leading-none">Contact</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Enrichment</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const isActive = currentScreen === item.id
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${isActive ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
            >
              <item.icon className="w-4.5 h-4.5 flex-shrink-0" />
              {item.label}
            </button>
          )
        })}
      </nav>
      <div className="p-4 border-t border-border">
        <div className="p-3 rounded-xl bg-secondary/60 text-xs text-muted-foreground">
          <p className="font-medium text-foreground mb-1">AI-Powered Pipeline</p>
          <p className="leading-relaxed">Role Filter, Industry Classifier, Quality Scorer & Company Enrichment</p>
        </div>
      </div>
    </div>
  )
}
