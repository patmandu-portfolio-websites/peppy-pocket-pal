param([switch]$Read, [switch]$ImportEnv)
$ErrorActionPreference = 'Stop'
$directory = Join-Path $env:LOCALAPPDATA 'Peppy'
$file = Join-Path $directory 'openai-key.xml'
if ($Read) {
    $secret = Import-Clixml -LiteralPath $file
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
} else {
    if ($ImportEnv) {
        $line = Get-Content -LiteralPath (Join-Path $PSScriptRoot '.env') | Where-Object { $_ -match '^\s*OPENAI_API_KEY\s*=' } | Select-Object -First 1
        if (-not $line) { throw 'No OPENAI_API_KEY was found in the local .env file.' }
        $value = ($line -replace '^\s*OPENAI_API_KEY\s*=\s*', '').Trim().Trim('"').Trim("'")
        if (-not $value) { throw 'The local OpenAI key is empty.' }
        $secret = ConvertTo-SecureString -String $value -AsPlainText -Force
        $value = $null
    } else {
        $secret = Read-Host 'OpenAI API key (stored with Windows user encryption, not in chat)' -AsSecureString
    }
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $secret | Export-Clixml -LiteralPath $file
    Write-Output 'Saved encrypted key for the current Windows user.'
}
