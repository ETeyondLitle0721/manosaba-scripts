#!/usr/bin/env pwsh
<#
.SYNOPSIS
    将指定目录下的所有文本文件拼接为一个文件。

.DESCRIPTION
    非递归地获取指定目录下的所有文件，对每个文本文件：
      - 在开头添加"文件名 + 换行"
      - 文件内容之间使用两个换行符分隔
    最终输出到该目录的上级目录下的 "<目录名称>.txt" 文件中。

.PARAMETER Directory
    要处理的目录路径（第一个命令行参数）。

.EXAMPLE
    ./Concat-TextFiles.ps1 -Directory ./mydata
    ./Concat-TextFiles.ps1 ./mydata
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Directory
)

$ErrorActionPreference = 'Stop'

# 解析为绝对路径
$dirPath = (Resolve-Path -LiteralPath $Directory).Path

if (-not (Test-Path -LiteralPath $dirPath -PathType Container)) {
    throw "指定的路径不是目录: $dirPath"
}

# 目录名
$dirName = Split-Path -Path $dirPath -Leaf
if ([string]::IsNullOrWhiteSpace($dirName)) {
    # 处理根目录等情况
    $dirName = ($dirPath -replace '[:\\/]', '_')
}

# 上级目录
$parentPath = Split-Path -Path $dirPath -Parent
if ([string]::IsNullOrWhiteSpace($parentPath)) {
    throw "无法获取目录的上级目录: $dirPath"
}

# 目标文件路径
$outputFile = Join-Path -Path $parentPath -ChildPath "$dirName.txt"

# 非递归获取目录下所有文件
$files = Get-ChildItem -LiteralPath $dirPath -File | Sort-Object Name

if ($files.Count -eq 0) {
    Write-Warning "目录 [$dirPath] 下没有文件，将生成空文件。"
}

$blocks = New-Object System.Collections.Generic.List[string]

foreach ($file in $files) {
    try {
        # 以文本方式读取（自动识别编码）
        $content = Get-Content -LiteralPath $file.FullName -Raw -ErrorAction Stop
    }
    catch {
        Write-Warning "跳过无法读取的文件 [$($file.FullName)]: $_"
        continue
    }

    if ($null -eq $content) { $content = '' }

    # 去掉内容末尾多余的换行，避免与分隔符叠加产生过多空行
    $content = $content.TrimEnd("`r", "`n")

    # 块：文件名 + 换行 + 内容
    $block = $file.Name + [Environment]::NewLine + $content
    $blocks.Add($block)
}

# 用两个换行符拼接所有块
$separator = [Environment]::NewLine + [Environment]::NewLine
$result = [string]::Join($separator, $blocks)

# 写入目标文件（UTF-8 无 BOM）
Set-Content -LiteralPath $outputFile -Value $result -Encoding utf8NoBOM -NoNewline

Write-Host "已处理 $($blocks.Count) 个文件。"
Write-Host "输出文件: $outputFile"