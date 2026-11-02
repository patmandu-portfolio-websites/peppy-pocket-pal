param([ValidateSet('Read', 'Write', 'Delete', 'Notify')][string]$Action)
$ErrorActionPreference = 'Stop'
$encoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $encoding
[Console]::OutputEncoding = $encoding
$directory = Join-Path $env:LOCALAPPDATA 'Peppy'
$file = Join-Path $directory 'gmail-token.xml'
if ($Action -eq 'Write') {
    $value = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($value)) { throw 'Empty Gmail credential.' }
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $secret = ConvertTo-SecureString -String $value -AsPlainText -Force
    $temporary = Join-Path $directory ([guid]::NewGuid().ToString() + '.xml')
    try {
        $secret | Export-Clixml -LiteralPath $temporary
        Move-Item -LiteralPath $temporary -Destination $file -Force
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
    }
} elseif ($Action -eq 'Read') {
    if (-not (Test-Path -LiteralPath $file)) { exit 0 }
    $secret = Import-Clixml -LiteralPath $file
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
} elseif ($Action -eq 'Delete') {
    if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
} else {
    $data = [Console]::In.ReadToEnd() | ConvertFrom-Json
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $icon = New-Object System.Windows.Forms.NotifyIcon
    try {
        $icon.Icon = [System.Drawing.SystemIcons]::Information
        $icon.Text = 'Peppy'
        $icon.Visible = $true
        $icon.ShowBalloonTip(7000, [string]$data.title, [string]$data.body, [System.Windows.Forms.ToolTipIcon]::Info)
        Start-Sleep -Seconds 8
    } finally { $icon.Dispose() }
}
