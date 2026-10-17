import React, { useState, useMemo } from 'react'
import {
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  FileJson,
  Search,
  X,
  ChevronRight,
  ChevronDown,
  AtSign,
  Copy,
  Check,
} from 'lucide-react'
import { useAppConfig } from '../context/ThemeLanguageContext'

export interface FileTreeNode {
  id: string
  name: string
  type: 'folder' | 'file'
  path: string
  size?: string
  extension?: string
  children?: FileTreeNode[]
}

export interface ProjectFilesDrawerProps {
  readonly isOpen: boolean
  readonly onClose: () => void
  readonly projectPath?: string
  readonly onSelectFile?: (filePath: string) => void
}

// The mobile protocol does not expose workspace file listing yet. Keep the drawer
// usable, but never present fixture files as if they came from the Host.
const DEFAULT_FILE_TREE: FileTreeNode[] = []

export const ProjectFilesDrawer: React.FC<ProjectFilesDrawerProps> = ({
  isOpen,
  onClose,
  projectPath = 'D:\\Company\\cinlan\\docs\\四个破甲',
  onSelectFile,
}) => {
  const { language } = useAppConfig()
  const isZh = language === 'zh-CN'

  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set(['f-docs', 'f-docs-armor'])
  )
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedPath, setCopiedPath] = useState<string | null>(null)

  const toggleFolder = (folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) {
        next.delete(folderId)
      } else {
        next.add(folderId)
      }
      return next
    })
  }

  const handleCopyPath = (path: string, e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard?.writeText(path)
    setCopiedPath(path)
    setTimeout(() => setCopiedPath(null), 1800)
  }

  const handleInsertReference = (filePath: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onSelectFile?.(filePath)
    onClose()
  }

  const filteredTree = useMemo(() => {
    if (!searchQuery.trim()) return DEFAULT_FILE_TREE

    const query = searchQuery.toLowerCase()

    const filterNodes = (nodes: FileTreeNode[]): FileTreeNode[] => {
      const results: FileTreeNode[] = []
      for (const node of nodes) {
        if (node.type === 'file') {
          if (
            node.name.toLowerCase().includes(query) ||
            node.path.toLowerCase().includes(query)
          ) {
            results.push(node)
          }
        } else if (node.children) {
          const matchedChildren = filterNodes(node.children)
          if (
            matchedChildren.length > 0 ||
            node.name.toLowerCase().includes(query)
          ) {
            results.push({
              ...node,
              children: matchedChildren,
            })
          }
        }
      }
      return results
    }

    return filterNodes(DEFAULT_FILE_TREE)
  }, [searchQuery])

  if (!isOpen) return null

  const renderNode = (node: FileTreeNode, depth = 0) => {
    const isExpanded = expandedFolderIds.has(node.id)

    if (node.type === 'folder') {
      return (
        <div key={node.id} className="space-y-0.5">
          <button
            type="button"
            onClick={() => toggleFolder(node.id)}
            style={{ paddingLeft: `${depth * 14 + 10}px` }}
            className="w-full py-2 pr-3 flex items-center justify-between text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.04] active:bg-black/[0.08] dark:active:bg-white/[0.08] rounded-xl transition"
          >
            <div className="flex items-center gap-2 min-w-0">
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 theme-muted shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 theme-muted shrink-0" />
              )}
              {isExpanded ? (
                <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
              ) : (
                <Folder className="w-4 h-4 text-amber-500 shrink-0" />
              )}
              <span className="text-xs font-medium theme-text truncate">{node.name}</span>
            </div>
            {node.children && (
              <span className="text-[10px] theme-muted font-mono">
                {node.children.length}
              </span>
            )}
          </button>

          {isExpanded && node.children && (
            <div className="space-y-0.5">
              {node.children.map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      )
    }

    // File item
    const getFileIcon = () => {
      switch (node.extension) {
        case 'json':
          return <FileJson className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
        case 'ts':
        case 'tsx':
        case 'js':
          return <FileCode className="w-3.5 h-3.5 text-blue-500 shrink-0" />
        default:
          return <FileText className="w-3.5 h-3.5 theme-muted shrink-0" />
      }
    }

    return (
      <div
        key={node.id}
        style={{ paddingLeft: `${depth * 14 + 26}px` }}
        className="w-full py-2 pr-3 flex items-center justify-between text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.04] active:bg-black/[0.08] dark:active:bg-white/[0.08] rounded-xl transition group"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
          {getFileIcon()}
          <span className="text-xs theme-text font-mono truncate">{node.name}</span>
          {node.size && (
            <span className="text-[10px] theme-muted font-mono shrink-0 ml-1">
              {node.size}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={(e) => handleInsertReference(node.name, e)}
            className="p-1 px-2 rounded-lg bg-blue-600/15 hover:bg-blue-600/25 text-blue-500 text-[10px] font-mono flex items-center gap-0.5 transition active:scale-95"
            title={isZh ? '引用此文件' : 'Reference file'}
          >
            <AtSign className="w-2.5 h-2.5" />
            <span>{isZh ? '引用' : 'Ref'}</span>
          </button>
          <button
            type="button"
            onClick={(e) => handleCopyPath(node.path, e)}
            className="p-1 theme-muted hover:theme-text rounded-lg hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition"
            title={isZh ? '复制路径' : 'Copy path'}
          >
            {copiedPath === node.path ? (
              <Check className="w-3 h-3 text-emerald-500" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      role="presentation"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col justify-end animate-fade-in"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-files-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full theme-card border-t theme-border rounded-t-3xl p-5 pb-8 space-y-4 shadow-2xl safe-bottom max-h-[85vh] flex flex-col animate-slide-up transition-colors duration-200"
      >
        {/* Drag handle */}
        <div className="w-10 h-1 rounded-full bg-zinc-400/40 mx-auto shrink-0" />

        {/* Header */}
        <div className="flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Folder className="w-5 h-5 text-amber-500 shrink-0" />
            <div className="min-w-0">
              <h2
                id="project-files-title"
                className="text-sm font-bold theme-text tracking-tight"
              >
                {isZh ? '项目文件' : 'Project Files'}
              </h2>
              <p className="text-[10px] theme-muted font-mono truncate max-w-[260px]">
                {projectPath}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 theme-muted hover:theme-text rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition"
            aria-label={isZh ? '关闭' : 'Close'}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="relative shrink-0">
          <Search className="w-3.5 h-3.5 theme-muted absolute left-3 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={isZh ? '搜索文件或路径...' : 'Search files or path...'}
            className="w-full pl-8 pr-8 py-2 theme-card-subtle border theme-border rounded-xl text-xs theme-text placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="p-1 theme-muted hover:theme-text absolute right-2 top-2"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Tree Container */}
        <div className="flex-1 overflow-y-auto min-h-[220px] max-h-[50vh] pr-1 space-y-0.5">
          {filteredTree.length === 0 ? (
            <div className="py-12 text-center text-xs theme-muted">
              {isZh ? '当前 Host 未提供文件列表接口' : 'The Host does not expose a file listing yet'}
            </div>
          ) : (
            filteredTree.map((node) => renderNode(node))
          )}
        </div>

        {/* Footer Hint */}
        <div className="pt-2 border-t theme-border flex items-center justify-between text-[11px] theme-muted shrink-0">
          <span>{isZh ? '点击“引用”可将文件 @ 插入对话' : 'Click "Ref" to insert @file'}</span>
          <span className="font-mono">Cinlan Companion</span>
        </div>
      </div>
    </div>
  )
}
