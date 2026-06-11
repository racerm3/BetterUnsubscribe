# Set to stop on any error
$ErrorActionPreference = "Stop"

$currentDir = Get-Location
$workingDir = Get-Item -Path (Join-Path -Path $currentDir -ChildPath "src")

Write-Host "The working directory path is:" $workingDir.Path

$manifestFile = "./src/manifest.json"

# Check if manifest.json exists and determine version
if (Test-Path "$manifestFile")
{
    if (Get-Command jq -ErrorAction SilentlyContinue)
    {
        Write-Host "jq is installed."
        $VERSION = & jq -r '.version' "$manifestFile"
    }
    else
    {
        Write-Host "jq is not installed."
        $VERSION = Select-String -Path "$manifestFile" -Pattern '"version"\s*:\s*"([^"]+)"' | ForEach-Object {
            $_.Matches[0].Groups[1].Value
        }
    }
    Write-Host "Version: $VERSION"
}
else
{
    Write-Host "Error: manifest.json not found."
    Exit 1
}

# Create build directory if it doesn't exist
$buildDir = Join-Path -Path $currentDir -ChildPath "build"
if (-not (Test-Path $buildDir))
{
    New-Item -ItemType Directory -Path $buildDir | Out-Null
    Write-Host "Created build directory: $buildDir"
}

# Define variables
$fileName = "BetterUnsubscribe-$VERSION"
$zipFileName = "$fileName.zip"
$xpiFileName = "$fileName.xpi"
$zipFilePath = Join-Path -Path "$buildDir" -ChildPath $zipFileName
$xpiFilePath = Join-Path -Path "$buildDir" -ChildPath $xpiFileName

# Add required .NET assemblies for compression
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Create the ZIP archive
if (Test-Path $zipFilePath)
{
    Remove-Item -Path $zipFilePath -Force
}
$zip = [System.IO.Compression.ZipFile]::Open($zipFilePath, [System.IO.Compression.ZipArchiveMode]::Create)

# Add all files from ./src into the root of the ZIP (no "src/" prefix)
$allFiles = Get-ChildItem -Path $workingDir.FullName -Recurse -File
foreach ($file in $allFiles)
{
    $relativePath = $file.FullName.Substring($workingDir.FullName.Length + 1) -replace '\\', '/'
    Write-Host "Adding: $relativePath"
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $relativePath)
}

# Release the ZIP file
$zip.Dispose()

# Output the location of the ZIP file
Write-Host "Directory compressed into: $zipFilePath"

# Check if the .xpi file already exists
if (Test-Path $xpiFilePath)
{
    Write-Host "Overwriting the existing file..."
    
    $tempXpiPath = "$xpiFilePath.old"
    if (Test-Path $tempXpiPath)
    {
        Remove-Item -Path $tempXpiPath -Force -ErrorAction SilentlyContinue
    }
    
    try
    {
        Rename-Item -Path $xpiFilePath -NewName (Split-Path $tempXpiPath -Leaf) -Force -ErrorAction Stop
        Remove-Item -Path $tempXpiPath -Force -ErrorAction SilentlyContinue
    }
    catch
    {
        # Fallback to direct deletion if rename fails
        Remove-Item -Path $xpiFilePath -Force
    }
}

# Rename the .zip file to .xpi
Rename-Item -Path $zipFilePath -NewName $xpiFileName
Write-Host "Archive renamed to: $xpiFileName"