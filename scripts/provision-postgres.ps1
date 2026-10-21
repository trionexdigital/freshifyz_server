param(
    [string]$SshHost = '72.61.240.123',
    [string]$SshKey = (Join-Path $env:USERPROFILE '.ssh\cook_and_eat_pg_setup')
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskEnvFile = Join-Path $taskRoot '.env'
$taskPassword = $null
foreach ($taskLine in [System.IO.File]::ReadAllLines($taskEnvFile)) {
    if ($taskLine -match '^PGPASSWORD="?([A-Za-z0-9_-]{48,256})"?$') { $taskPassword = $matches[1] }
}
if (!$taskPassword) { throw 'Configure a generated PGPASSWORD in .env first. The script never changes an existing password.' }
$taskScript = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'provision-postgres.py')))
$taskCommand = "python3 -c `"import base64; exec(compile(base64.b64decode('$taskScript'), 'freshifyz-provision.py', 'exec'))`""
$taskPayload = @{ app_password = $taskPassword } | ConvertTo-Json -Compress
try {
    $taskPayload | & "$env:WINDIR\System32\OpenSSH\ssh.exe" -i $SshKey -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o ConnectTimeout=10 "root@$SshHost" $taskCommand
    if ($LASTEXITCODE -ne 0) { throw 'Remote Freshifyz provisioning failed. No automatic credential rotation is performed.' }
} finally { $taskPassword = $null; $taskPayload = $null }
