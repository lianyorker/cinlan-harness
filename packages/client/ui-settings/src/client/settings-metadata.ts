/** Settings-owned navigation metadata and localized, value-free search entries. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type { LocaleFace } from '@deepseek-ai/dsh-client-ui-slots'

/** Standard settings navigation groups; their labels and order belong to the shell. */
export type SettingsGroupId = 'personal' | 'ai' | 'development' | 'tools' | 'extensions' | 'experimental'

/** Group assignment for one settings.section registration. */
export interface SettingsSectionMetadata {
  /** Stable settings.section registration id. */
  readonly sectionId: string
  /** Shell-owned navigation group. */
  readonly groupId: SettingsGroupId
}

/** Searchable UI copy only; resolvers must never return settings values or secrets. */
export interface SettingsItemMetadata {
  /** Stable item identity, unique throughout its section. */
  readonly id: string
  /** data-settings-anchor value, unique throughout the section, including other tabs. */
  readonly anchorId: string
  /** @returns the visible item label in the current locale. */
  readonly title: () => string
  /** @returns the visible explanation in the current locale. */
  readonly description?: () => string
  /** @returns public search terms in the current locale; omission publishes an empty array. */
  readonly keywords?: () => readonly string[]
  /** Tab to select before locating the anchor. */
  readonly tabId?: string
}

/** Localized item data published to the settings shell. */
export interface SettingsResolvedItemMetadata {
  /** Owning settings.section registration id. */
  readonly sectionId: string
  /** Stable item identity within the section. */
  readonly id: string
  /** Matching data-settings-anchor value. */
  readonly anchorId: string
  /** Localized visible item label. */
  readonly title: string
  /** Localized visible explanation, when supplied. */
  readonly description?: string
  /** Localized public search terms. */
  readonly keywords: readonly string[]
  /** Tab to select before locating the anchor. */
  readonly tabId?: string
}

/** Immutable metadata in registration order; consumers join sections to live slots. */
export interface SettingsMetadataSnapshot {
  /** Explicit group assignments; page labels, order, and icons remain slot-owned. */
  readonly sections: readonly SettingsSectionMetadata[]
  /** Items may precede their section metadata or its live slot. */
  readonly items: readonly SettingsResolvedItemMetadata[]
}

interface ItemBatch {
  sectionId: string
  items: readonly SettingsItemMetadata[]
}

function resolveItems({ sectionId, items }: ItemBatch): readonly SettingsResolvedItemMetadata[] {
  return items.map(item => Object.freeze({
    sectionId,
    id: item.id,
    anchorId: item.anchorId,
    title: item.title(),
    ...(item.description === undefined ? {} : { description: item.description() }),
    keywords: Object.freeze([...(item.keywords?.() ?? [])]),
    ...(item.tabId === undefined ? {} : { tabId: item.tabId }),
  }))
}

/** Effect-owned metadata registry with one stable observable per service lifetime. */
export class SettingsMetadataService extends Service {
  private snapshot: SettingsMetadataSnapshot = Object.freeze({
    sections: Object.freeze([]),
    items: Object.freeze([]),
  })
  private readonly batches = new Set<ItemBatch>()
  private readonly listeners = new Set<() => void>()

  /** @param ctx - providing ui-settings fiber. */
  constructor(ctx: Context) {
    super(ctx, 'settingsMetadata')
    ctx.effect(() => () => {
      this.listeners.clear()
      this.batches.clear()
      this.publish([], [])
    }, 'ui-settings: metadata lifetime')
    // Locale depends on settingsScope; its observation must not delay that service.
    ctx.inject(['locale'], (localeCtx) => {
      // The shared face avoids a project-reference cycle through the locale plugin.
      const locale = localeCtx.get('locale') as LocaleFace
      const refresh = (): void => {
        this.publish(this.snapshot.sections, [...this.batches].flatMap(resolveItems))
      }
      localeCtx.effect(() => locale.subscribe(refresh), 'ui-settings: metadata locale revisions')
      refresh()
    })
  }

  /**
   * Read the committed section and field metadata.
   * @returns the same immutable snapshot until metadata or a locale revision changes.
   */
  getSnapshot(): SettingsMetadataSnapshot {
    return this.snapshot
  }

  /**
   * Observe committed registrations, removals, and locale revisions.
   * @param listener - callback invoked after the next snapshot is published.
   * @returns idempotent unsubscribe; service disposal also removes every listener.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Assign a group independently of item registration and slot availability.
   * @param input - section id and its navigation group.
   * @returns idempotent disposer owned by the calling plugin's effect lifetime.
   * @throws when the section id already has a live metadata owner.
   */
  registerSection(input: SettingsSectionMetadata): () => void {
    const dispose = this.ctx.effect(() => {
      const { sectionId, groupId } = input
      if (this.snapshot.sections.some(section => section.sectionId === sectionId)) {
        throw new Error(`settings metadata section "${sectionId}" is already registered`)
      }
      const section = Object.freeze({ sectionId, groupId })
      this.publish([...this.snapshot.sections, section], this.snapshot.items)
      return () => {
        if (!this.snapshot.sections.includes(section)) return
        this.publish(this.snapshot.sections.filter(entry => entry !== section), this.snapshot.items)
      }
    }, `ui-settings: metadata section ${input.sectionId}`)
    return () => { void dispose() }
  }

  /**
   * Register public item copy; section metadata may arrive before or after it.
   * IDs and anchors are unique per section across all tabs. Register alongside
   * the corresponding components in the same slots.inject lifetime.
   * @param sectionId - owning settings.section registration id.
   * @param items - item identities and locale resolvers; never include values or secrets.
   * @returns idempotent disposer removing only this batch, owned by the calling fiber.
   * @throws on duplicate item ids or anchors, or when a locale resolver throws;
   * the rejected batch publishes no items.
   */
  registerItems(sectionId: string, items: readonly SettingsItemMetadata[]): () => void {
    const dispose = this.ctx.effect(() => {
      const existing = this.snapshot.items.filter(item => item.sectionId === sectionId)
      const ids = new Set(existing.map(item => item.id))
      const anchors = new Set(existing.map(item => item.anchorId))
      const batch: ItemBatch = {
        sectionId,
        items: items.map((item) => {
          if (ids.has(item.id)) {
            throw new Error(`settings metadata item "${item.id}" is already registered in section "${sectionId}"`)
          }
          if (anchors.has(item.anchorId)) {
            throw new Error(`settings metadata anchor "${item.anchorId}" is already registered in section "${sectionId}"`)
          }
          ids.add(item.id)
          anchors.add(item.anchorId)
          return {
            id: item.id, anchorId: item.anchorId, title: item.title,
            ...(item.keywords === undefined ? {} : { keywords: item.keywords }),
            ...(item.description === undefined ? {} : { description: item.description }),
            ...(item.tabId === undefined ? {} : { tabId: item.tabId }),
          }
        }),
      }
      const resolved = resolveItems(batch)
      this.batches.add(batch)
      this.publish(this.snapshot.sections, [...this.snapshot.items, ...resolved])
      return () => {
        if (!this.batches.delete(batch)) return
        const ownedIds = new Set(batch.items.map(item => item.id))
        this.publish(this.snapshot.sections, this.snapshot.items.filter(item =>
          item.sectionId !== sectionId || !ownedIds.has(item.id)))
      }
    }, `ui-settings: metadata items ${sectionId}`)
    return () => { void dispose() }
  }

  private publish(
    sections: readonly SettingsSectionMetadata[],
    items: readonly SettingsResolvedItemMetadata[],
  ): void {
    this.snapshot = Object.freeze({ sections: Object.freeze(sections), items: Object.freeze(items) })
    notifySubscribers(this.listeners, 'settings metadata')
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Settings-owned section groups and localized public search metadata. */
    settingsMetadata: SettingsMetadataService
  }
}
