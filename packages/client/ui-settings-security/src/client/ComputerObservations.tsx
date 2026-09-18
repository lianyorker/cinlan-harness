/** Read-only Computer Use descriptor facts from the connected Host's Provider check. */
import type { ReactNode } from 'react'
import type { DeviceCapabilitySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import type { CapabilitySectionProps } from './CapabilitySection.tsx'
import type { CapabilitySettingsKey } from './locales.ts'
import css from './CapabilitySection.module.css'

type Observation = NonNullable<DeviceCapabilitySnapshot['computer']>

function ComputerSupportDetails({ observation, t }: { observation: Observation } & Pick<CapabilitySectionProps, 't'>): ReactNode {
  const { supports } = observation
  const groups: readonly { title: CapabilitySettingsKey; fields: readonly (readonly [CapabilitySettingsKey, boolean])[] }[] = [
    { title: 'computerApps', fields: [
      ['computerList', supports.apps.list], ['computerBundleIds', supports.apps.bundleIds], ['computerPids', supports.apps.pids],
    ] },
    { title: 'computerWindows', fields: [
      ['computerList', supports.windows.list], ['computerTargetById', supports.windows.targetById],
      ['computerTargetByIndex', supports.windows.targetByIndex], ['computerFocus', supports.windows.focus],
      ['computerMoveResize', supports.windows.moveResize],
    ] },
    { title: 'computerObservation', fields: [
      ['computerScreenshot', supports.observation.screenshot], ['computerAnnotatedScreenshot', supports.observation.annotatedScreenshot],
      ['computerElementFrames', supports.observation.elementFrames], ['computerOcr', supports.observation.ocr],
    ] },
    { title: 'computerActions', fields: [
      ['computerClick', supports.actions.click], ['computerTypeText', supports.actions.typeText],
      ['computerPressKey', supports.actions.pressKey], ['computerHotkey', supports.actions.hotkey],
      ['computerPasteText', supports.actions.pasteText], ['computerScroll', supports.actions.scroll],
      ['computerDrag', supports.actions.drag], ['computerSetValue', supports.actions.setValue],
      ['computerPerformAction', supports.actions.performAction],
    ] },
    { title: 'computerSurfaces', fields: [
      ['computerMenus', supports.surfaces.menus], ['computerDialogs', supports.surfaces.dialogs],
      ['computerDock', supports.surfaces.dock], ['computerMenubar', supports.surfaces.menubar],
    ] },
  ]
  return <dl className={css.facts}>
    {groups.map(group => <div key={group.title}>
      <dt>{t(group.title)}</dt><dd><ul>{group.fields.map(([label, supported]) => <li key={label}>
        {t(label)}: {t(supported ? 'computerSupported' : 'computerUnsupported')}
      </li>)}</ul></dd>
    </div>)}
  </dl>
}

/**
 * Present only published descriptor values; the readiness check does not probe permissions.
 * @param props - Latest descriptor, check progress, and localized labels.
 * @returns Searchable machine and permission sections, including missing observations.
 */
export function ComputerObservations({ observation, loading, t }: {
  observation: DeviceCapabilitySnapshot['computer']
  loading: boolean
} & Pick<CapabilitySectionProps, 't'>): ReactNode {
  return <>
    <section className={css.computerHowTo} data-settings-anchor="computer-observations">
      <h2>{t('computerMachine')}</h2>
      <p>{t('computerLocalLimit')}</p>
      {loading || observation === undefined ? <p role="status">{t(loading ? 'deviceChecking' : 'computerObservationUnavailable')}</p> : <>
        <dl className={css.facts}>
          <div><dt>{t('computerPlatform')}</dt><dd>{observation.platform}</dd></div>
          <div><dt>{t('computerProvider')}</dt><dd>{observation.provider}</dd></div>
          <div><dt>{t('computerProviderVersion')}</dt><dd>{observation.providerVersion}</dd></div>
          <div><dt>{t('computerProtocolVersion')}</dt><dd>{observation.protocolVersion}</dd></div>
        </dl>
        <ComputerSupportDetails observation={observation} t={t} />
      </>}
    </section>
    <section className={css.computerHowTo} data-settings-anchor="computer-permissions">
      <h2>{t('computerPermissions')}</h2>
      <p role="status">{t('computerPermissionsUnknown')}</p>
      <p>{t('computerPermissionsHelp')}</p>
    </section>
  </>
}
