/** Fixed official Windows assets; Google transport SHA-1 was checked before recording SHA-256. */
import type { MobileResourceDefinition, MobileResourceId } from './types.ts'
/** Reviewed small upstream components; no emulator images or arbitrary URLs. */
export const catalog: Readonly<Record<MobileResourceId, MobileResourceDefinition>> = {
  'platform-tools': { id: 'platform-tools', version: '37.0.1', platform: 'win32-x64',
    url: 'https://dl.google.com/android/repository/platform-tools_r37.0.1-win.zip',
    sha256: '45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99', bytes: 8044989,
    archiveRoot: 'platform-tools', executable: 'adb.exe',
    licenseUrl: 'https://developer.android.com/studio/terms', licenseName: 'Android SDK License Agreement and bundled notices',
  },
  scrcpy: { id: 'scrcpy', version: '4.1', platform: 'win32-x64',
    url: 'https://github.com/Genymobile/scrcpy/releases/download/v4.1/scrcpy-win64-v4.1.zip',
    sha256: '5b12172b3264b2889f4583ee64752ce832e29bc8b1089dca81093459697165db', bytes: 11305298,
    archiveRoot: 'scrcpy-win64-v4.1', executable: 'scrcpy.exe',
    licenseUrl: 'https://github.com/Genymobile/scrcpy/blob/v4.1/LICENSE', licenseName: 'Apache-2.0 and bundled component licenses',
  },
}
