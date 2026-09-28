; Reject an active Desktop process before electron-builder extracts the NSIS payload.
!macro customHeader
  !ifndef BUILD_UNINSTALLER
    LangString DSH_INSTALLER_RUNNING ${LANG_ENGLISH} "DeepSeek Harness is running. Close it before installing or updating."
    LangString DSH_INSTALLER_RUNNING ${LANG_SIMPCHINESE} "DeepSeek Harness 正在运行，请先关闭应用再安装或更新。"
    !macro customCheckAppRunning
      nsProcess::FindProcess "${APP_EXECUTABLE_FILENAME}"
      Pop $0
      ${If} $0 == 0
        MessageBox MB_OK|MB_ICONEXCLAMATION "$(DSH_INSTALLER_RUNNING)" /SD IDOK
        SetErrorLevel 2
        Quit
      ${EndIf}
    !macroend
  !endif
!macroend
