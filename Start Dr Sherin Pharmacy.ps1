$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectDir
npm start
Read-Host "Press Enter to close"
