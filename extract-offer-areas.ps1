[CmdletBinding()]
param(
    [string[]]$OffersRoots = @(),
    [string]$CachePath = '',
    [string]$OverridesPath = '',
    [int]$Limit = 0,
    [switch]$Force,
    [switch]$ShowText
)

$ErrorActionPreference = 'Stop'

if (-not $OffersRoots.Count) {
    $OffersRoots = @(
        (Join-Path $PSScriptRoot ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('0J7RhNGE0LXRgNGLINCd0L7QstC+0YHRgtGA0L7QudC60Lg=')))),
        (Join-Path $PSScriptRoot ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('0J7RhNGE0LXRgNGLINCd0L7QstC+0YHRgtGA0L7QudC60LggMg==')))),
        (Join-Path $PSScriptRoot ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('0J7RhNGE0LXRgNGLINCd0L7QstC+0YHRgtGA0L7QudC60LggMw==')))),
        (Join-Path $PSScriptRoot ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('0KDQsNGB0YHRgNC+0YfQutCw'))))
    )
}
if ([string]::IsNullOrWhiteSpace($CachePath)) { $CachePath = Join-Path $PSScriptRoot 'offer-area-cache.json' }
if ([string]::IsNullOrWhiteSpace($OverridesPath)) { $OverridesPath = Join-Path $PSScriptRoot 'offer-area-overrides.json' }

if ($PSVersionTable.PSEdition -ne 'Desktop') {
    throw 'Run this OCR script with Windows PowerShell: powershell.exe -File .\extract-offer-areas.ps1'
}

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]

function Wait-WinRtOperation {
    param(
        [Parameter(Mandatory)]$Operation,
        [Parameter(Mandatory)][Type]$ResultType
    )

    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
        Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
        Select-Object -First 1
    $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
    $task.Wait()
    return $task.Result
}

function Get-RelativePathCompat {
    param(
        [Parameter(Mandatory)][string]$BasePath,
        [Parameter(Mandatory)][string]$Path
    )

    $baseUri = New-Object Uri(($BasePath.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar))
    $pathUri = New-Object Uri($Path)
    return [Uri]::UnescapeDataString($baseUri.MakeRelativeUri($pathUri).ToString()).Replace('/', [IO.Path]::DirectorySeparatorChar)
}

function Get-AreaCandidates {
    param([AllowEmptyString()][string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) { return @() }
    $normalized = $Text -replace [char]0x00A0, ' '
    $matches = [regex]::Matches($normalized, '(?<!\d)(\d{1,3}(?:[,.]\d{1,2})?)(?!\d)')
    $values = @()
    foreach ($match in $matches) {
        $numberText = $match.Groups[1].Value.Replace(',', '.')
        $value = 0.0
        if (-not [double]::TryParse($numberText, [Globalization.NumberStyles]::Number, [Globalization.CultureInfo]::InvariantCulture, [ref]$value)) { continue }
        if ($value -lt 15 -or $value -gt 300) { continue }

        $tailLength = [Math]::Min(12, $normalized.Length - ($match.Index + $match.Length))
        $tail = if ($tailLength -gt 0) { $normalized.Substring($match.Index + $match.Length, $tailLength) } else { '' }
        if ($tail -match '^\s*%') { continue }
        $hasUnit = $tail -match '^\s*(?:\u043c\s*(?:\u00b2|2)|m\s*(?:\u00b2|2)|\u043a\u0432\.?\s*\u043c)'
        $hasFraction = $match.Groups[1].Value -match '[,.]'
        if (-not $hasUnit -and -not $hasFraction) { continue }

        $values += [pscustomobject]@{
            Value = [Math]::Round($value, 2)
            HasUnit = $hasUnit
            Index = $match.Index
        }
    }
    return @($values | Sort-Object Value -Descending -Unique)
}

function Read-ImageText {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Engine
    )

    $file = Wait-WinRtOperation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
    $stream = Wait-WinRtOperation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
        $decoder = Wait-WinRtOperation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Wait-WinRtOperation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        try {
            $result = Wait-WinRtOperation ($Engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
            return $result.Text
        }
        finally {
            if ($bitmap) { $bitmap.Dispose() }
        }
    }
    finally {
        if ($stream) { $stream.Dispose() }
    }
}

$existing = @{}
if (Test-Path -LiteralPath $CachePath -PathType Leaf) {
    try {
        $cache = Get-Content -LiteralPath $CachePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cache.entries) {
            foreach ($property in $cache.entries.PSObject.Properties) {
                $existing[$property.Name] = $property.Value
            }
        }
    }
    catch {
        Write-Warning "Could not read the area cache: $CachePath"
    }
}

$overrides = @{}
if (Test-Path -LiteralPath $OverridesPath -PathType Leaf) {
    $overrideData = Get-Content -LiteralPath $OverridesPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($property in $overrideData.PSObject.Properties) {
        $overrides[$property.Name] = [double]$property.Value
    }
}

$language = New-Object Windows.Globalization.Language('ru-RU')
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
if (-not $engine) { throw 'Windows OCR for ru-RU is unavailable.' }

$processedFolderName = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('0J7QsdGA0LDQsdC+0YLQsNC90L3Ri9C1'))

$files = @(
    foreach ($root in $OffersRoots) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        Get-ChildItem -LiteralPath $root -Recurse -File |
            Where-Object { $_.Directory.Name -eq $processedFolderName -and $_.Extension -match '^\.(?:png|jpe?g|webp)$' }
    }
) | Sort-Object FullName

if ($Limit -gt 0) { $files = @($files | Select-Object -First $Limit) }

$entries = [ordered]@{}
$processed = 0
$recognized = 0
$failed = 0
foreach ($file in $files) {
    $key = (Get-RelativePathCompat -BasePath $PSScriptRoot -Path $file.FullName) -replace '\\', '/'
    $fingerprint = "$($file.Length):$($file.LastWriteTimeUtc.Ticks)"
    if ($overrides.ContainsKey($key)) {
        $entries[$key] = [pscustomobject][ordered]@{
            fingerprint = $fingerprint
            areaSqm = $overrides[$key]
            candidates = @($overrides[$key])
            source = 'manual-override'
        }
        $recognized++
        continue
    }
    $cached = $existing[$key]
    if (-not $Force -and $cached -and $cached.fingerprint -eq $fingerprint) {
        $entries[$key] = $cached
        if ($null -ne $cached.areaSqm) { $recognized++ }
        continue
    }

    $nameCandidates = @(Get-AreaCandidates -Text $file.BaseName)
    if ($nameCandidates.Count) {
        $entries[$key] = [pscustomobject][ordered]@{
            fingerprint = $fingerprint
            areaSqm = $nameCandidates[0].Value
            candidates = @($nameCandidates | Select-Object -ExpandProperty Value)
            source = 'filename'
        }
        $recognized++
        continue
    }

    $processed++
    try {
        $text = Read-ImageText -Path $file.FullName -Engine $engine
        $candidates = @(Get-AreaCandidates -Text $text)
        $withUnit = @($candidates | Where-Object HasUnit)
        $selected = if ($withUnit.Count) { $withUnit | Select-Object -First 1 } else { $candidates | Select-Object -First 1 }
        $row = [ordered]@{
            fingerprint = $fingerprint
            areaSqm = if ($selected) { $selected.Value } else { $null }
            candidates = @($candidates | Select-Object -ExpandProperty Value)
        }
        if ($selected) { $recognized++ }
        $entries[$key] = [pscustomobject]$row
        if ($ShowText) {
            Write-Host "[$key] area=$($row.areaSqm) candidates=$($row.candidates -join ', ')"
            Write-Host $text
        }
        elseif ($processed % 25 -eq 0) {
            Write-Host "OCR: processed $processed new files..."
        }
    }
    catch {
        $failed++
        $entries[$key] = [pscustomobject][ordered]@{
            fingerprint = $fingerprint
            areaSqm = $null
            candidates = @()
            error = $_.Exception.Message
        }
        Write-Warning "OCR failed for $key"
    }
}

$output = [ordered]@{
    generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
    entries = $entries
}
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($CachePath, (($output | ConvertTo-Json -Depth 8) + "`n"), $utf8)
Write-Host "Area OCR: recognized $recognized of $($files.Count); processed $processed new files; errors $failed."
Write-Host "Area cache: $CachePath"
