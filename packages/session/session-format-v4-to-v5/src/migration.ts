/** Streaming V4-to-V5 identity conversion with seed-cut and delivery-generation admission. */
import { defineSessionFormatMigration, SessionFormatError, SessionFormatUnsupportedMigrationError, isSessionFormatJsonObject } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatEvent, SessionFormatEventRun, SessionFormatMigrationContext, SessionFormatMigrationStage, SessionFormatMigrationStageInput } from '@deepseek-ai/dsh-session-format'
import { assertReleasedV4Header, validateDeliveryAccepted } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import { assertReleasedV5Header } from './validation.ts'

/** Adjacent migration preserving event JSON, ordering, identifiers, references, and inherited cuts. */
export const sessionFormatV4ToV5 = defineSessionFormatMigration({
  name: '@deepseek-ai/dsh-session-format-v4-to-v5',
  fromVersion: 4,
  toVersion: 5,
  migrateHeader(header) {
    assertReleasedV4Header(header)
    return { ...header, version: 5 }
  },
  createStage: input => new V4ToV5Stage(input),
  validateTargetHeader: assertReleasedV5Header,
})

class V4ToV5Stage implements SessionFormatMigrationStage {
  readonly headerInheritedEventCount?: number
  private cut: number | undefined
  private count = 0
  private foreignDeliverySeq: number | undefined

  constructor(private readonly input: SessionFormatMigrationStageInput) {
    this.cut = input.sourceInheritedEventCount ?? (input.sourceHeader.isSeeded ? undefined : 0)
    if (this.cut !== undefined) this.headerInheritedEventCount = this.cut
  }

  transformEvent(event: SessionFormatEvent, context: SessionFormatMigrationContext): void {
    if (event.seq !== this.count) throw new SessionFormatError('V4 source events must be dense')
    if (event.type === 'session-log-deepseek/delivery-accepted'
      && isSessionFormatJsonObject(event.data) && event.data['sessionFormatVersion'] === 5) {
      throw new SessionFormatUnsupportedMigrationError('format v4 delivery marker claims target format v5')
    }
    const deliveryId = validateDeliveryAccepted(event, 4)
    if (deliveryId !== undefined && deliveryId !== this.input.sourceHeader.id) this.foreignDeliverySeq = event.seq
    if (event.type === 'session/end-seed' && isSessionFormatJsonObject(event.data) && event.data['inherited'] === true) {
      if (!this.input.sourceHeader.isSeeded) throw new SessionFormatError('unseeded format v4 Session contains an inherited end-seed marker')
      this.cut = event.seq
    }
    this.count += 1
    context.emitEvent(event)
  }

  transformRun(run: SessionFormatEventRun, context: SessionFormatMigrationContext): void {
    for (const event of run.expand()) this.transformEvent(event, context)
  }

  finish(): number {
    if (this.cut === undefined) throw new SessionFormatError('seeded format v4 Session has no inherited end-seed marker')
    if (this.cut > this.count) throw new SessionFormatError('format v4 inherited event count exceeds its events')
    if (this.foreignDeliverySeq !== undefined
      && !(this.input.sourceHeader.parentSession !== undefined && this.foreignDeliverySeq < this.cut)) {
      throw new SessionFormatUnsupportedMigrationError('format v4 delivery marker names the wrong Session')
    }
    return this.cut
  }
}
