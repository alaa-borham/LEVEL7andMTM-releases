; LEVEL7 and MTM — the full program as an installer (0.9.306). Built on Windows by windows-program.yml from the sealed
; program folder:  iscc /DAppVersion=<v> /DSourceDir=<folder> tools\installer-cad.iss
; Installed for this Windows user (no administrator, the folder stays writable for the program's own updates), the
; program's folder readable by Windows' sandbox (what «LEVEL7 - first run.cmd» did), a desktop shortcut. The program's
; data (sign-in, designs, settings) is kept elsewhere and never touched. A release that changes the sealed core runs this
; installer itself (/SILENT /LAUNCH=1) after the admin approved it: the program starts again afterwards.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\LEVEL7-and-MTM-" + AppVersion + "-win32-x64"
#endif

[Setup]
AppId={{7C2E4B19-5A3D-4F8E-B6C1-9D0A2E4F6B83}
AppName=LEVEL7 and MTM
AppVersion={#AppVersion}
AppPublisher=LEVEL7
DefaultDirName={localappdata}\Programs\LEVEL7 and MTM
DefaultGroupName=LEVEL7 and MTM
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\dist
OutputBaseFilename=LEVEL7-and-MTM-{#AppVersion}-Setup
SetupIconFile={#SourceDir}\resources\app\assets\icon.ico
UninstallDisplayIcon={app}\LEVEL7 and MTM.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "arabic"; MessagesFile: "compiler:Languages\Arabic.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[InstallDelete]
; the program's pages come whole from this version (files of an older version are not left beside them)
Type: filesandordirs; Name: "{app}\resources\app"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Excludes: "LEVEL7 - first run.cmd"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\LEVEL7 and MTM"; Filename: "{app}\LEVEL7 and MTM.exe"
Name: "{group}\{cm:UninstallProgram,LEVEL7 and MTM}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\LEVEL7 and MTM"; Filename: "{app}\LEVEL7 and MTM.exe"

[Run]
; Windows' sandbox may read the program's folder (otherwise the program does not start in some folders)
Filename: "{sys}\icacls.exe"; Parameters: """{app}"" /grant ""*S-1-15-2-1:(OI)(CI)(RX)"" /T /Q"; Flags: runhidden waituntilterminated
Filename: "{app}\LEVEL7 and MTM.exe"; Description: "{cm:LaunchProgram,LEVEL7 and MTM}"; Flags: nowait postinstall skipifsilent
; the program's own update (started with /SILENT /LAUNCH=1): start it again
Filename: "{app}\LEVEL7 and MTM.exe"; Flags: nowait runasoriginaluser; Check: LaunchAfterUpdate

[Code]
function LaunchAfterUpdate: Boolean;
begin
  Result := ExpandConstant('{param:LAUNCH|0}') = '1';
end;
