# Lance tous les serveurs du karaoké. Un serveur déjà démarré (port en écoute) est laissé tranquille : relancer le script ne fait rien de plus.
#   .\start-karaoke.ps1              tout lancer
#   .\start-karaoke.ps1 -NoEngine    sans le moteur Python d'alignement (web_lyrics_karaoke/engine)
param([switch]$NoEngine)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

$services = @(
    @{ Name = 'Accords (maître + hub /sync)'; Port = 5180; Dir = 'web_chords_karaoke'; Kind = 'npm' }
    @{ Name = 'Guitare (lecture seule)';      Port = 5190; Dir = 'web_guitar_karaoke'; Kind = 'npm' }
    @{ Name = 'Paroles (front)';              Port = 5173; Dir = 'web_lyrics_karaoke\web'; Kind = 'npm' }
    @{ Name = 'Paroles (moteur Python)';      Port = 8000; Dir = 'web_lyrics_karaoke\engine'; Kind = 'engine' }
)

function Test-Listening($port) {
    [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

function Start-Window($title, $dir, $command) {
    $cmd = "`$Host.UI.RawUI.WindowTitle = '$title'; Set-Location '$dir'; $command"
    Start-Process powershell -WindowStyle Minimized -ArgumentList '-NoExit', '-NoProfile', '-Command', $cmd
}

foreach ($s in $services) {
    if ($NoEngine -and $s.Kind -eq 'engine') { continue }
    $dir = Join-Path $root $s.Dir
    $label = '{0,-32} :{1}' -f $s.Name, $s.Port

    if (Test-Listening $s.Port) { Write-Host "[déjà démarré] $label" -ForegroundColor DarkGray; continue }

    if ($s.Kind -eq 'npm') {
        if (-not (Test-Path (Join-Path $dir 'node_modules'))) {
            Write-Host "npm install : $($s.Dir)..." -ForegroundColor Yellow
            Push-Location $dir; npm.cmd install; Pop-Location
        }
        Start-Window $s.Name $dir 'npm.cmd run dev'
    } else {
        if (-not (Test-Path (Join-Path $dir '.venv\Scripts\python.exe'))) {
            Write-Host "[ignoré] $label : venv absent, lancer web_lyrics_karaoke\engine\setup.ps1" -ForegroundColor Yellow
            continue
        }
        Start-Window $s.Name $dir '.\.venv\Scripts\python.exe -m uvicorn karaoke_engine.main:app --host 0.0.0.0 --port 8000'
    }
    Write-Host "[démarré]      $label" -ForegroundColor Green
}

Write-Host ''
Write-Host 'Lecteur d''accords : http://localhost:5180   Playlist : http://localhost:5180/playlist.html'
Write-Host 'Guitare            : http://localhost:5190   Paroles  : http://localhost:5173/#/sync'
