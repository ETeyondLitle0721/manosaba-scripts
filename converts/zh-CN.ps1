# Windows PowerShell 5.1 / PowerShell 7；与配套更新后的 Node 脚本一起使用。
$ErrorActionPreference = 'Stop'

# 配置路径
$BundleDir = "D:\特殊文件夹\文档\ManosabaNaniScripts"
$LocaleBundleDir = "D:\特殊文件夹\文档\ManosabaZhCNLocale"
$UnityDataTool = "E:\UnityDataTool\UnityDataTool.exe"
$NodeScript = "D:\Workspace\Visual-Studio-Code\deliverable\convert-to-nani.mjs"
$NodeDir = Split-Path -Parent $NodeScript
$AliasFile = Join-Path $NodeDir 'aliases.json'
$DumpDir = Join-Path $BundleDir 'DumpedTxt'
$OutputDir = Join-Path $BundleDir 'zh-CN'
# $true：任何台词/选项缺少翻译即让该 CAB 转换失败；$false：保留原文并记录。
$RequireTranslations = $true

foreach ($dir in @($BundleDir, $LocaleBundleDir)) {
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { throw "找不到目录: $dir" }
}
foreach ($file in @($UnityDataTool, $NodeScript, $AliasFile, (Join-Path $NodeDir 'localization.mjs'), (Join-Path $NodeDir 'parse-unity-dump.mjs'))) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "找不到文件: $file" }
}
$NodeExe = (Get-Command node -CommandType Application -ErrorAction Stop).Source
# 如原先那样，只处理目录直接包含的 .bundle，避免收集输出或其他目录文件。
$bundleFiles = @(Get-ChildItem -LiteralPath $BundleDir -Filter '*.bundle' -File | Sort-Object Name)
$localeFiles = @(Get-ChildItem -LiteralPath $LocaleBundleDir -Filter '*.bundle' -File | Sort-Object Name)
if ($bundleFiles.Count -eq 0) { throw "没有剧情 .bundle: $BundleDir" }
if ($localeFiles.Count -eq 0) { throw "没有本地化 .bundle: $LocaleBundleDir" }

# 每次运行全新目录：不会捡到上次执行遗留的 CAB。
$RunDir = Join-Path $DumpDir ([guid]::NewGuid().ToString('N'))
$LocaleDumpDir = Join-Path $RunDir 'Locale'
$ScriptDumpDir = Join-Path $RunDir 'Scripts'
$ReportDir = Join-Path $RunDir 'Reports'
foreach ($dir in @($LocaleDumpDir, $ScriptDumpDir, $ReportDir, $OutputDir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

function Export-UnityBundle {
    param([System.IO.FileInfo]$Bundle, [string]$DestinationRoot)
    $work = Join-Path ([IO.Path]::GetTempPath()) ('nani-dump-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $work | Out-Null
    try {
        Push-Location -LiteralPath $work
        try {
            Write-Host "  -> UnityDataTool dump: $($Bundle.Name)"
            # 原脚本约定：UnityDataTool 将 CAB-*.txt 写到当前工作目录。
            & $UnityDataTool dump $Bundle.FullName 2>&1 | Out-Host
            $code = $LASTEXITCODE
            if ($code -ne 0) { throw "UnityDataTool 失败，退出码 $code : $($Bundle.Name)" }
        } finally { Pop-Location }
        $cabs = @(Get-ChildItem -LiteralPath $work -Filter 'CAB-*.txt' -File -Recurse | Sort-Object FullName)
        if ($cabs.Count -eq 0) { throw "未在本次工作目录找到 CAB-*.txt: $($Bundle.Name)" }
        $dest = Join-Path $DestinationRoot $Bundle.BaseName
        New-Item -ItemType Directory -Path $dest -Force | Out-Null
        $result = @()
        for ($i = 0; $i -lt $cabs.Count; $i++) {
            $target = Join-Path $dest ('{0:D3}-{1}' -f $i, $cabs[$i].Name)
            Move-Item -LiteralPath $cabs[$i].FullName -Destination $target
            $result += Get-Item -LiteralPath $target
        }
        return $result
    } finally {
        if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
    }
}

Write-Host "先导出 $($localeFiles.Count) 个中文本地化 bundle..." -ForegroundColor Cyan
# 任一本地化 bundle 导出失败即停止，避免用不完整翻译继续处理。
foreach ($file in $localeFiles) {
    $null = @(Export-UnityBundle -Bundle $file -DestinationRoot $LocaleDumpDir)
}

$failures = @()
$converted = 0
$current = 0
foreach ($file in $bundleFiles) {
    $current++
    Write-Host "`n[$current/$($bundleFiles.Count)] 正在处理 $($file.Name)" -ForegroundColor Yellow
    try {
        $cabs = @(Export-UnityBundle -Bundle $file -DestinationRoot $ScriptDumpDir)
        $bundleReports = Join-Path $ReportDir $file.BaseName
        New-Item -ItemType Directory -Path $bundleReports -Force | Out-Null
        foreach ($cab in $cabs) {
            # 一个 bundle 可导出多个 CAB，其中纯资源对象不需要转换。
            if (-not (Select-String -LiteralPath $cab.FullName -SimpleMatch '  playlist (ScriptPlaylist)' -Quiet -Encoding UTF8)) {
                Write-Host "  -> 跳过无剧情对象: $($cab.Name)"
                continue
            }
            $report = Join-Path $bundleReports ($cab.BaseName + '.report.json')
            $nodeArgs = @($NodeScript, $cab.FullName, '--out', $OutputDir, '--aliases', $AliasFile, '--locale', $LocaleDumpDir, '--report', $report, '--strict')
            if ($RequireTranslations) { $nodeArgs += '--require-translations' }
            & $NodeExe @nodeArgs 2>&1 | Out-Host
            if ($LASTEXITCODE -ne 0) { throw "Node 转换失败: $($cab.Name)，退出码 $LASTEXITCODE" }
            $converted++
        }
    } catch {
        $failures += "$($file.Name): $($_.Exception.Message)"
        Write-Warning $failures[-1]
    }
}
Write-Host "`n输出目录: $OutputDir" -ForegroundColor Cyan
Write-Host "本次 dump 和报告: $RunDir"
if ($failures.Count -gt 0) {
    Write-Host ($failures -join "`n") -ForegroundColor Red
    throw "$($failures.Count) 个 bundle 处理失败；已生成的文件是部分结果，请查看上述错误。"
}
if ($converted -eq 0) { throw '未找到可转换的剧情 CAB；没有生成新脚本。' }
Write-Host "完成：成功转换 $converted 个 CAB，中文脚本位于 zh-CN。" -ForegroundColor Green
