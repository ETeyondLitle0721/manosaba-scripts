# 简体中文转换版

用此目录的全部代码文件替换你本地 `D:\Workspace\Visual-Studio-Code\deliverable` 中对应文件，然后运行 `convert.ps1`。不要只更新 PS1：旧版 JS 不支持本次新增的 --locale 参数。

## 已配置的路径

- 剧情 bundle：`D:\特殊文件夹\文档\ManosabaNaniScripts`
- 中文 bundle：`D:\特殊文件夹\文档\ManosabaZhCNLocale`
- UnityDataTool：`E:\UnityDataTool\UnityDataTool.exe`
- 最终脚本：`D:\特殊文件夹\文档\ManosabaNaniScripts\zh-CN\<原脚本路径>.nani`
- 每次导出和报告：`ManosabaNaniScripts\DumpedTxt\<本次运行ID>\`

如工具位置变化，修改 convert.ps1 顶部配置即可。脚本采用 UTF-8 BOM 保存，兼容 Windows PowerShell 5.1 中文路径；生成 .nani 使用 UTF-8。

## 执行流程

1. 在本地化目录中查找直接包含的 *.bundle，逐个调用 UnityDataTool dump。
2. 每个 bundle 在全新临时工作目录导出，收集全部 CAB-*.txt，不再只取第一个，也不在旧工作目录中兜底搜索。随后移动到本次 dump 目录。
3. 逐个导出剧情 bundle，识别包含 playlist 的 CAB。
4. Node 按“完整脚本路径 + 文本ID”应用中文，并将完整剧情脚本写入 zh-CN。保留命令、标签、台词ID和原脚本行号。
5. 每个 CAB 单独保存转换报告，避免批处理时报告相互覆盖。报告包含翻译计数、缺失项及语音关联线索。

默认 `$RequireTranslations = $true`：任何可本地化参数缺少翻译，该 CAB 转换失败，写出前检查，最终批处理以错误结束；其他已成功 CAB 属于部分结果。如果需要未译部分回退原文，将它改为 `$false`，并查看报告中的 translation.missing。输出目录不会自动清理，以免删除已有文件；失败后已有旧文件仍可能存在，应以本次成功状态和报告为准。

同一个脚本路径如果在多个剧情 bundle 中重复出现，后处理的结果会覆盖前者，处理顺序按 bundle 名称排序。这个工具不会为重复版本选择“最新”或合并剧情。

## 中文本地化格式

本次文件为 TextAsset，m_Script 含实际多行本地化文档，不能用原缩进 AST 解析正文。localization.mjs 按 TextAsset 对象边界截取正文，读取文档头的完整 script path，再解析 `# 文本ID` 分段；忽略原文注释。

多行译文转换为单行参数：已有 `<br>` 后的物理换行移除，其他换行转换为 `<br>`，避免脚本行号漂移或产生重复换行。空段视为缺失译文，不清空台词；同一脚本和ID出现不同译文则报冲突。保留段内空格、全角空格与富文本。

输出包含所有剧情命令，是已经替换中文的完整 .nani，不是只含翻译条目的 Naninovel localization document。zh-CN 是你指定的输出目录名；如需在 Unity 运行时作为语言包安装，仍需按该项目的资源/本地化配置部署，不能仅凭文件夹名自动注册语言。

## 单独使用 Node（已有 dump）

```powershell
node .\convert-to-nani.mjs .\CAB-ed2f69.dump.txt --out .\zh-CN --aliases .\aliases.json --locale '.\CAB-ce605c585d6e79fd21f0eb3d9526fe70(1).txt' --strict --require-translations
```

`--locale` 也可以是包含多份本地化 dump 的目录（递归读取 *.txt），或指定一个 dump 文件。脚本路径作用域内匹配，避免跨章节同名 ID 误替换。

## 验证情况

使用你上传的中文本地化文件和此前 CAB-ed2f69 剧情样本，生成 44 个中文脚本，替换 2796 处可本地化文本（台词和选项等），缺失翻译 0。中文结果已放在本包 zh-CN 目录。

```powershell
node .\test-localization.mjs .\CAB-ed2f69.dump.txt '.\CAB-ce605c585d6e79fd21f0eb3d9526fe70(1).txt'
```

测试通过：中文台词、跨行译文、全部脚本行数和语音关联不变、缺失翻译严格失败/原文回退、冲突翻译报错。原始 dump 和 dump.cs 未重复包含在本包。aliases.json 沿用你提供 dump.cs 提取的 140 项映射；extract-aliases.mjs 可用于重新提取。

当前环境没有 PowerShell 和 Windows UnityDataTool，未实际执行 PS1 或在 Unity 中播放；已完成 Node 端真实样本转换和测试。PowerShell 部分沿用你现有工具的 `UnityDataTool dump <bundle>` 约定，要求工具输出到当前工作目录，否则会明确报错。运行语音仍依赖原游戏音频配置和资源。
