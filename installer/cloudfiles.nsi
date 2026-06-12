; installer/cloudfiles.nsi
; Cloudfiles Windows 安装程序 (NSIS)
; 使用方法: makensis /DVERSION=x.x.x installer/cloudfiles.nsi

!include "MUI2.nsh"
!include "FileFunc.nsh"

; ========================================
; 基本信息配置
; ========================================

!define APPNAME "Cloudfiles"
!ifndef VERSION
  !define VERSION "2.0.0"
!endif
!define PUBLISHER "Cloudfiles Team"
!define REGKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"

Name "${APPNAME} ${VERSION}"
OutFile "Cloudfiles-Setup-${VERSION}.exe"
Unicode true

InstallDir "$LOCALAPPDATA\Programs\${APPNAME}"
RequestExecutionLevel user

; ========================================
; 界面配置
; ========================================

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Cloudfiles Setup.bat"
!define MUI_FINISHPAGE_RUN_TEXT "运行 Cloudfiles 设置向导"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"

; ========================================
; 安装段
; ========================================

Section "Install" SecInstall
  SectionIn RO

  SetOutPath $INSTDIR

  ; 复制所有文件
  File /r "dist\cloudfiles\*.*"
  File /r "dist\cloudfiles\*"

  ; 创建开始菜单快捷方式
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Cloudfiles Server.lnk" "$INSTDIR\Cloudfiles Server.bat"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Cloudfiles Setup.lnk" "$INSTDIR\Cloudfiles Setup.bat"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\Uninstall.lnk" "$INSTDIR\uninstall.exe"

  ; 创建桌面快捷方式
  CreateShortcut "$DESKTOP\Cloudfiles Server.lnk" "$INSTDIR\Cloudfiles Server.bat"

  ; 写入卸载信息到注册表
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "${REGKEY}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "${REGKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${REGKEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${REGKEY}" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "${REGKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${REGKEY}" "DisplayIcon" "$INSTDIR\node.exe"
  WriteRegDWORD HKCU "${REGKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${REGKEY}" "NoRepair" 1

  ; 写入安装大小
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${REGKEY}" "EstimatedSize" "$0"
SectionEnd

; ========================================
; 卸载段
; ========================================

Section "Uninstall"
  ; 删除快捷方式
  Delete "$SMPROGRAMS\${APPNAME}\Cloudfiles Server.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Cloudfiles Setup.lnk"
  Delete "$SMPROGRAMS\${APPNAME}\Uninstall.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"
  Delete "$DESKTOP\Cloudfiles Server.lnk"

  ; 删除应用文件
  Delete "$INSTDIR\server.js"
  Delete "$INSTDIR\main.js"
  Delete "$INSTDIR\setup.js"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\package-lock.json"
  Delete "$INSTDIR\node.exe"
  Delete "$INSTDIR\Cloudfiles Server.bat"
  Delete "$INSTDIR\Cloudfiles Setup.bat"
  Delete "$INSTDIR\uninstall.exe"

  RMDir /r "$INSTDIR\lib"
  RMDir /r "$INSTDIR\index"
  RMDir /r "$INSTDIR\node_modules"

  ; 保留用户数据目录
  RMDir "$INSTDIR"

  ; 删除注册表
  DeleteRegKey HKCU "${REGKEY}"
SectionEnd
