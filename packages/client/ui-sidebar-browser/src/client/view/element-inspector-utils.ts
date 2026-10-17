/** Helper utilities for DOM element inspection and markdown formatting. */

/** Inspected DOM element information. */
export interface InspectedElementData {
  readonly tagName: string
  readonly selector: string
  readonly text?: string | undefined
  readonly rect: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
  readonly role?: string | undefined
  readonly id?: string | undefined
  readonly className?: string | undefined
  readonly ariaLabel?: string | undefined
  readonly pageUrl?: string | undefined
}

/** Compute an informative CSS selector for a DOM element. */
export function getElementSelector(el: Element): string {
  if (el.id) {
    return `#${el.id}`
  }
  const tagName = el.tagName.toLowerCase()
  if (el.className && typeof el.className === 'string') {
    const classes = el.className
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .filter(c => !c.startsWith('_') && !c.includes(':') && !c.includes('{'))
    if (classes.length > 0) {
      return `${tagName}.${classes.join('.')}`
    }
  }
  if (el.parentElement) {
    const siblings = Array.from(el.parentElement.children).filter(c => c.tagName === el.tagName)
    if (siblings.length > 1) {
      const index = siblings.indexOf(el) + 1
      return `${getElementSelector(el.parentElement)} > ${tagName}:nth-of-type(${index})`
    }
    return `${getElementSelector(el.parentElement)} > ${tagName}`
  }
  return tagName
}

/** Extract inspection details from an Element. */
export function extractElementData(el: Element, pageUrl?: string): InspectedElementData {
  const rect = el.getBoundingClientRect()
  const selector = getElementSelector(el)
  const role = el.getAttribute('role') ?? undefined
  const ariaLabel = el.getAttribute('aria-label') ?? el.getAttribute('aria-description') ?? undefined
  const id = el.id || undefined
  const className = typeof el.className === 'string' && el.className.trim() ? el.className.trim() : undefined
  const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 150) || undefined

  return {
    tagName: el.tagName,
    selector,
    text,
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    role,
    id,
    className,
    ariaLabel,
    pageUrl,
  }
}

/** Format inspected element into structured Markdown for session draft injection. */
export function formatInspectedElementMarkdown(data: InspectedElementData): string {
  const lines: string[] = [
    `[UI Element Inspection]`,
    `- Page URL: ${data.pageUrl || 'unknown'}`,
    `- Element: <${data.tagName.toLowerCase()}>`,
    `- Selector: \`${data.selector}\``,
  ]
  if (data.role) {
    lines.push(`- Role: ${data.role}`)
  }
  if (data.ariaLabel) {
    lines.push(`- Label: "${data.ariaLabel}"`)
  }
  if (data.text) {
    const truncatedText = data.text.length > 100 ? `${data.text.slice(0, 100)}…` : data.text
    lines.push(`- Text: "${truncatedText}"`)
  }
  lines.push(`- Dimensions: ${Math.round(data.rect.width)}x${Math.round(data.rect.height)} at (${Math.round(data.rect.x)}, ${Math.round(data.rect.y)})`)
  return lines.join('\n')
}
