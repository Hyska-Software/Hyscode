; VORTEX CLI standalone installer for Windows
; Requires Inno Setup 6+ (https://jrsoftware.org/isinfo.php)

#define MyAppName "VORTEX CLI"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "HysCode"
#define MyAppURL "https://github.com/Hyska-Software/Hyscode"
#define MyAppExeName "vortex.exe"

#ifndef VortexCliSourceDir
#define VortexCliSourceDir "..\..\tools\hyscode-tui\dist\vortex-production"
#endif

[Setup]
AppId={{8F6F8E4C-2C4B-4E90-9F0B-4B1C0E6A2A41}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={localappdata}\Vortex\bin
DisableDirPage=yes
DefaultGroupName={#MyAppName}
AllowNoIcons=yes
OutputDir=..\..\tools\hyscode-tui\dist\vortex-installer
OutputBaseFilename=Vortex-CLI-Setup-{#MyAppVersion}-x64
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
ChangesEnvironment=yes
MinVersion=10.0.17763

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "german"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
Name: "addtopath"; Description: "Add VORTEX to the user PATH (requires a new terminal)"; GroupDescription: "Installation options:"

[Files]
Source: "{#VortexCliSourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--help"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"

[Registry]
Root: HKCU; Subkey: "Environment"; ValueType: expandsz; ValueName: "Path"; ValueData: "{olddata};{app}"; Tasks: addtopath; Check: NeedsAddPath(ExpandConstant('{app}'))

[Run]
Filename: "{app}\{#MyAppExeName}"; Parameters: "--help"; Description: "Show VORTEX CLI help"; Flags: postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
function NeedsAddPath(Param: string): boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', OrigPath) then
  begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + Param + ';', ';' + OrigPath + ';') = 0;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Path: string;
  InstallDir: string;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    InstallDir := ExpandConstant('{app}');
    if RegQueryStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', Path) then
    begin
      StringChangeEx(Path, ';' + InstallDir, '', True);
      StringChangeEx(Path, InstallDir + ';', '', True);
      StringChangeEx(Path, InstallDir, '', True);
      RegWriteStringValue(HKEY_CURRENT_USER, 'Environment', 'Path', Path);
    end;
  end;
end;
