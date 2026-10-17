import type { AntiSlopFinding, AntiSlopReport } from '../../types.ts'

interface LintRule {
  level: 'FAIL' | 'WARN'
  id: string
  pattern: RegExp
  message: string
}

/** The 22 Anti-Slop verification rules distilled from TasteSkill v2. */
export const ANTI_SLOP_RULES: readonly LintRule[] = [
  {
    level: 'FAIL',
    id: 'mono',
    pattern: /\bfont-mono\b|font-family\s*:[^;{}]*(mono\b|monospace|Courier|Consolas|Menlo|Monaco)|(JetBrains|Geist|IBM\+?Plex|Space|DM|Roboto|Fragment|Azeret|Red\+?Hat|Martian|Commit|Departure|Fira)[+_ ]?Mono|Geist_Mono|GeistMono|Fira[+ ]Code|ui-monospace/i,
    message: 'Monospace typeface detected outside literal code blocks. Use proportional fonts for UI.',
  },
  {
    level: 'FAIL',
    id: 'gradient',
    pattern: /(linear|radial|conic)-gradient\(|\bbg-(gradient|linear|radial|conic)-|\b(from|via)-(?!\[?0)[a-z]+-\d{2,3}\b/,
    message: 'Generative gradient fill detected. Use solid ground or a photography scrim.',
  },
  {
    level: 'FAIL',
    id: 'gradient-text',
    pattern: /bg-clip-text|background-clip\s*:\s*text|text-transparent/,
    message: 'Gradient or clipped text detected. Use solid high-contrast ink.',
  },
  {
    level: 'FAIL',
    id: 'shadow',
    pattern: /box-shadow\s*:\s*(?!none|0 0 #0000|var\(--tw)|\bshadow(-(sm|md|lg|xl|2xl|inner|\[[^\]]+\]))?(?=["'\s`])(?<!-shadow)|drop-shadow\(|\bdrop-shadow(-|\b)|text-shadow\s*:\s*(?!none)/,
    message: 'Arbitrary resting shadow detected. Resting surfaces carry none; reserve shadows for overlays.',
  },
  {
    level: 'FAIL',
    id: 'numbering',
    pattern: />\s*[(\[]?0[1-9][)\]]?\.?\s*<|["'`]\s*0[1-9]\s*["'`]|decimal-leading-zero|>\s*(Step|Phase|No\.?|Chapter)\s*0?\d\s*</i,
    message: 'Decorative index numbering (01 / 02 / 03) detected. This is a dead AI template tell.',
  },
  {
    level: 'FAIL',
    id: 'eyebrow',
    pattern: /class(Name)?\s*=\s*["'`{][^"'`}]*\b(eyebrow|kicker|overline|pretitle|pre-title|suptitle|sup-title|tagline-label|section-label|section-tag)\b|\.(eyebrow|kicker|overline|pretitle|section-label|section-tag)\b\s*[{,]/i,
    message: 'Eyebrow / kicker label placed above a heading. Say the thing directly.',
  },
  {
    level: 'FAIL',
    id: 'micro-label',
    pattern: /(?=[^"'`]*\buppercase\b)(?=[^"'`]*\btracking-(wide|wider|widest|\[[^\]]+\])\b)(?=[^"'`]*\btext-(xs|\[1[0-3]px\]|\[0?\.[67]\d*rem\])\b)[^"'`]+/,
    message: 'Tiny uppercase letter-spaced micro-label detected. High cognitive friction.',
  },
  {
    level: 'FAIL',
    id: 'purple-accent',
    pattern: /\b(bg|text|from|to|via|border|ring|fill|stroke|shadow|decoration|outline)-(purple|violet|indigo|fuchsia)-\d{2,3}\b|#(6366f1|8b5cf6|7c3aed|a855f7|4f46e5|a78bfa|818cf8|9333ea|6d28d9|c084fc)\b/i,
    message: 'Indigo / violet generative default accent. Pick a palette grounded in brand materials.',
  },
  {
    level: 'FAIL',
    id: 'claude-palette',
    pattern: /#(d97757|da7756|c15f3c|cc785c|bd5d3a|f0eee6|faf9f5|f5f4ed|eeece2|e8e6dc)\b/i,
    message: 'Anthropic terracotta/cream palette tell. Develop a differentiated palette.',
  },
  {
    level: 'FAIL',
    id: 'emoji-ui',
    pattern: /[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}\u{2600}-\u{26FF}]/u,
    message: 'Emoji used as product UI icon. Use bespoke SVG line icons.',
  },
  {
    level: 'FAIL',
    id: 'lorem-ipsum',
    pattern: /lorem ipsum|dolor sit amet/i,
    message: 'Placeholder lorem ipsum detected. Always ship concrete domain-specific text.',
  },
  {
    level: 'FAIL',
    id: 'hairline-rule',
    pattern: /<hr\b|\bdivide-[xy](-\d|\b)|\b(h|w)-px\b|border-(top|bottom|left|right)\s*:\s*(0?\.5|1)px|\bborder-[tblrxy](?![-\w])|\bborder-[tblrxy]-(?!0\b|none)\[?1?(px)?\]?(?=["'\s`])|height\s*:\s*1px/,
    message: 'Hairline divider line. Separate sections with whitespace or tonal shift.',
  },
  {
    level: 'WARN',
    id: 'stock-copy',
    pattern: /\b(unlock|unleash|supercharge|seamless(ly)?|elevate|empower(s|ing)?|revolutioni[sz]e|game[- ]chang(er|ing)|cutting[- ]edge|next[- ]gen(eration)?|world[- ]class|best[- ]in[- ]class|all[- ]in[- ]one|effortless(ly)?|blazing(ly)?[- ]fast|lightning[- ]fast|reimagin(e|ed|ing)|delve|tapestry|leverage|synergy|streamline|robust|holistic|turbocharge|transform the way|take your .{1,30} to the next level|say goodbye to|in today'?s|the future of|built for the modern)\b/i,
    message: 'Stock AI marketing copy detected. Describe specifically what the tool does.',
  },
  {
    level: 'WARN',
    id: 'default-font',
    pattern: /family=(Inter|Poppins|Montserrat|Roboto|Open\+Sans|Space\+Grotesk|Instrument\+Serif|Playfair\+Display|Plus\+Jakarta\+Sans|Outfit|Sora|Lato|Nunito|Raleway)\b|font-family\s*:\s*["']?(Inter|Poppins|Montserrat|Roboto|Space Grotesk|Instrument Serif|Playfair Display|Plus Jakarta Sans|Outfit|Sora)\b/i,
    message: 'Default web font fallback detected. Adopt a deliberate display face from the direction library.',
  },
  {
    level: 'WARN',
    id: 'mobile-100vh',
    pattern: /\bh-screen\b|height\s*:\s*100vh/,
    message: '100vh causes layout jumps on mobile address bars. Use 100dvh or 100svh.',
  },
]

/**
 * Run Anti-Slop lint on text or HTML string.
 * @param content - Text, CSS, or HTML content to inspect.
 * @returns An AntiSlopReport with health score and individual findings.
 */
export function runAntiSlopLint(content: string): AntiSlopReport {
  if (!content || content.trim().length === 0) {
    return { score: 100, fails: 0, warns: 0, findings: [] }
  }

  const lines = content.split(/\r?\n/)
  const findings: AntiSlopFinding[] = []
  let insideCode = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    if (/<pre\b|<code\b/i.test(line)) insideCode = true
    if (/<\/pre>|<\/code>/i.test(line)) insideCode = false

    for (const rule of ANTI_SLOP_RULES) {
      if (insideCode && (rule.id === 'mono' || rule.id === 'hairline-rule')) continue
      if (rule.pattern.test(line)) {
        findings.push({
          level: rule.level,
          ruleId: rule.id,
          message: rule.message,
          line: i + 1,
          sample: line.trim().slice(0, 100),
        })
      }
    }
  }

  const fails = findings.filter(f => f.level === 'FAIL').length
  const warns = findings.filter(f => f.level === 'WARN').length
  const rawScore = 100 - fails * 15 - warns * 5
  const score = Math.max(0, Math.min(100, rawScore))

  return { score, fails, warns, findings }
}
