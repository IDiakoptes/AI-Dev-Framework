[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryPath,

    [switch]$IncludeWorkflows,

    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Result {
    param(
        [string]$Status,
        [string]$Path,
        [string]$Message
    )

    Write-Host "[$Status] $Path - $Message"
}

function Initialize-Directory {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
        Write-Result -Status 'CREATED' -Path $Path -Message 'Directory created'
    }
}

function Copy-IfAllowed {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Source file missing: $Source"
    }

    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
        if (-not $Force) {
            Write-Result -Status 'SKIPPED' -Path $Destination -Message 'File exists (use -Force to overwrite)'
            return
        }

        Copy-Item -LiteralPath $Source -Destination $Destination -Force
        Write-Result -Status 'UPDATED' -Path $Destination -Message 'Overwritten due to -Force'
        return
    }

    Copy-Item -LiteralPath $Source -Destination $Destination
    Write-Result -Status 'CREATED' -Path $Destination -Message 'File copied'
}

$scriptRoot = $PSScriptRoot
$frameworkRoot = Split-Path -Parent $scriptRoot

$resolvedRepoPath = Resolve-Path -LiteralPath $RepositoryPath -ErrorAction Stop
$targetRoot = $resolvedRepoPath.Path

if (-not (Test-Path -LiteralPath (Join-Path $targetRoot '.git'))) {
    throw "Target path is not a Git repository: $targetRoot"
}

$pathsToEnsure = @(
    '.github',
    '.github/agents',
    '.github/instructions',
    '.github/plans',
    '.github/reviews',
    'templates',
    'docs',
    'scripts'
)

foreach ($relativePath in $pathsToEnsure) {
    Initialize-Directory -Path (Join-Path $targetRoot $relativePath)
}

$filesToCopy = @(
    '.github/agents/planning-agent.agent.md',
    '.github/agents/implementation-agent.agent.md',
    '.github/agents/code-review-agent.agent.md',
    '.github/agents/documentation-agent.agent.md',
    '.github/instructions/agent-workflow.instructions.md',
    '.github/instructions/security.instructions.md',
    '.github/instructions/testing.instructions.md',
    '.github/instructions/documentation.instructions.md',
    '.github/plans/README.md',
    '.github/reviews/README.md',
    'templates/copilot-instructions.md',
    'templates/repository-context.md',
    'docs/architecture.md',
    'docs/installation.md',
    'docs/configuration.md',
    'docs/agents.md',
    'docs/workflow.md',
    'docs/customization.md',
    'scripts/install-ai-framework.ps1'
)

if ($IncludeWorkflows) {
    $filesToCopy += '.github/workflows/framework-validation.yml'
}

foreach ($relativeFile in $filesToCopy) {
    $source = Join-Path $frameworkRoot $relativeFile
    $destination = Join-Path $targetRoot $relativeFile

    $destinationDir = Split-Path -Parent $destination
    Initialize-Directory -Path $destinationDir

    Copy-IfAllowed -Source $source -Destination $destination
}

Write-Host ''
Write-Host 'Installation complete.'
Write-Host 'Review SKIPPED items and rerun with -Force if intentional overwrite is required.'
