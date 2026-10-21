param(
    [string]$SshHost = '72.61.240.123',
    [string]$SshKey = (Join-Path $env:USERPROFILE '.ssh\cook_and_eat_pg_setup')
)
$ErrorActionPreference = 'Stop'
Write-Host 'Freshifyz PostgreSQL tunnel: 127.0.0.1:65432 -> VPS 127.0.0.1:55432. Keep this terminal open.'
& "$env:WINDIR\System32\OpenSSH\ssh.exe" -i $SshKey -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -N -L 127.0.0.1:65432:127.0.0.1:55432 "root@$SshHost"
exit $LASTEXITCODE
