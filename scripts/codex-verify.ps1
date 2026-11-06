$ErrorActionPreference = 'Stop'
# 型チェック → テスト → 本番ビルド。どれかが失敗したら止まる
Set-Location (Split-Path $PSScriptRoot -Parent)

$steps = @(
  @{ Name = 'typecheck'; Args = @('run', 'typecheck') },
  @{ Name = 'test'; Args = @('test') },
  @{ Name = 'build'; Args = @('run', 'build') }
)

foreach ($s in $steps) {
  Write-Host "== $($s.Name)"
  & npm.cmd @($s.Args)
  if ($LASTEXITCODE -ne 0) {
    Write-Error "$($s.Name) failed"
    exit 1
  }
}
Write-Host 'All checks passed.'
