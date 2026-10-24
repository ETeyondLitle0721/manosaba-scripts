# Manosaba Scripts

用于还原 Unity 游戏中 Naninovel 剧情脚本的 Node.js 工具集。项目读取 UnityDataTool 导出的序列化文本，解析脚本对象、命令引用和文本映射，重新生成可阅读、可检查的 `.nani` 文件，并支持将本地化文本应用到完整剧情脚本中。

当前实现包含针对 Manosaba 项目自定义命令的处理与别名提取逻辑。还原结果适合剧情整理、本地化分析和脚本结构研究；能否直接在 Unity / Naninovel 中运行，仍取决于对应版本、自定义命令、资源及项目配置。

## 编写来源

本项目代码的 AI 编写来源如下：

| 文件范围 | 编写来源 |
| --- | --- |
| `parse-unity-dump.mjs` | DeepSeek |
| `converts/ja-JP.ps1` | DeepSeek |
| 其余代码文件，包括转换、本地化、别名提取、中文批处理及测试脚本 | ChatGPT |

本 README 由 ChatGPT 重写。以上为工具代码的编写来源说明，游戏原有剧情文本与资源不属于 AI 编写内容。

## 主要功能

- 将基于空格缩进的 Unity dump 文本解析为 AST，提供对象、数组、字段和 managed reference 查询。
- 将带有 `playlist` 的脚本对象转换为 `.nani`，优先根据 `lines` 还原行序、缩进、标签、注释和空行。
- 还原命令、内联命令、参数、表达式与文本 ID；通过别名表映射命令名和参数名。
- 按「完整脚本路径 + 文本 ID」匹配本地化文本，避免跨章节同名 ID 误替换。
- 输出 JSON 转换报告，记录命令数量、翻译统计、语音关联线索及转换问题。
- 提供 Windows PowerShell 批处理脚本，串联 bundle 导出与 Node.js 转换。

## 环境与输入

- **Node.js 18 或更高版本**：使用原生 ES Modules 和 Node.js 内置模块，无第三方依赖，无需 `npm install`。
- **UnityDataTool**：从 `.bundle` 导出文本时需要；已有 dump 文本则可直接使用 Node.js。
- **PowerShell**：仅批量处理需要。中文批处理面向 Windows PowerShell 5.1 / PowerShell 7。
- **输入文件**：剧情 bundle 的 UnityDataTool 文本 dump；应用翻译时另需本地化 TextAsset dump；提取别名时另需 `dump.cs`。

本包未附带 UnityDataTool、原始 bundle、原始 dump 或 `dump.cs`，需自行准备。Node.js 转换器本身不直接读取 bundle。

## 文件说明

| 路径 | 用途 |
| --- | --- |
| `parse-unity-dump.mjs` | dump 文本解析及 AST 查询，也可单独运行查看结构 |
| `convert-to-nani.mjs` | 剧情还原入口，生成 `.nani` 和转换报告 |
| `localization.mjs` | 读取本地化 TextAsset，合并与校验翻译 |
| `extract-aliases.mjs` | 从 `dump.cs` 提取命令、参数别名及继承关系 |
| `aliases.example.json` | 别名配置格式示例，含占位内容，不宜直接作为完整配置 |
| `aliases.json` | 当前默认别名配置；本包中为空对象 `{}` |
| `aliases.new.json` | 已有的另一份别名映射，使用前应核对与目标版本是否一致 |
| `converts/ja-JP.ps1` | 原文（日文）批量导出与转换 |
| `converts/zh-CN.ps1` | 中文本地化批量导出与转换 |
| `scripts/ja-JP/`、`scripts/zh-CN/` | 本包已有的日文、中文脚本结果 |
| `test.mjs`、`test-v2.mjs`、`test-localization.mjs` | 面向特定样本的回归测试 |
| `console.log` | 已有运行日志 |

## 快速开始：已有 dump

以下命令在项目根目录运行；示例输入文件名需替换为实际文件。

### 1. 准备命令别名

如有目标版本的 `dump.cs`，建议重新提取：

```powershell
node ./extract-aliases.mjs ./dump.cs ./aliases.json
```

也可在核对版本后通过 `--aliases ./aliases.new.json` 使用已有映射。转换器不会自动加载任何别名文件；未提供映射或未匹配到条目时，使用序列化类名与字段名。

别名配置示例：

```json
{
  "Gosub": {
    "command": "gosub",
    "parameters": { "Path": "" }
  }
}
```

参数别名为空字符串表示无名参数。映射可使用类名或包含命名空间的类名，后者优先。

### 2. 还原原文脚本

```powershell
node ./convert-to-nani.mjs ./story.dump.txt --out ./output/ja-JP --aliases ./aliases.json --strict
```

结果按原脚本路径写入，例如 `output/ja-JP/Act01_Chapter01/Act01_Chapter01_Adv01.nani`。默认报告位于输出目录的 `conversion-report.json`。

### 3. 应用中文本地化

```powershell
node ./convert-to-nani.mjs ./story.dump.txt --out ./output/zh-CN --aliases ./aliases.json --locale ./locale-dumps --require-translations --report ./reports/story.json --strict
```

`--locale` 可指向单个本地化 dump 文件，或包含多份 `.txt` 文件的目录；目录会递归读取。生成结果是已替换译文的**完整剧情脚本**，不是仅含翻译条目的本地化文档。

## 转换器参数

```text
node convert-to-nani.mjs <dump.txt> [选项]
```

| 参数 | 说明 |
| --- | --- |
| `--out <目录>` | 输出目录，默认 `nani` |
| `--aliases <JSON文件>` | 命令与参数别名映射，默认无映射 |
| `--locale <文件或目录>` | 本地化 TextAsset dump |
| `--require-translations` | 有缺失翻译则失败；必须同时提供 `--locale` |
| `--report <JSON文件>` | 报告路径，默认 `<输出目录>/conversion-report.json` |
| `--strict` | 报告中出现任何转换问题即失败 |
| `--help` | 显示用法 |

未开启 `--require-translations` 时，缺失译文回退原文，并记录在 `translation.missing` 中。转换阶段的严格检查在写出前进行；检查失败不会为该次调用生成新的脚本或报告，具体原因见终端错误。

## 从 bundle 批量处理

两个 PowerShell 脚本顶部都包含本机绝对路径，运行前必须修改。它们只枚举指定目录直接包含的 `.bundle` 文件。

### 原文（日文）批处理

修改 `converts/ja-JP.ps1` 中的 `$BundleDir`、`$UnityDataTool` 和 `$NodeScript`，然后运行：

```powershell
& ./converts/ja-JP.ps1
```

当前实现将 dump 保存到 `$BundleDir/DumpedTxt`，转换时切换到 Node 脚本所在目录，因此 `.nani` 默认写入该目录下的 `nani/`，不会自动写入 `scripts/ja-JP/`。

该脚本只取找到的第一个 `CAB-*.txt`，并会在当前目录和 Node 脚本目录查找，可能拾取遗留文件；也未传入别名、严格模式或独立报告参数。多 CAB bundle 或需要明确错误检查时，建议单独导出并使用上述 Node.js 命令逐个转换。批处理的「完成」提示不能代替结果与退出状态检查。

### 中文批处理

修改 `converts/zh-CN.ps1` 中的剧情目录 `$BundleDir`、本地化目录 `$LocaleBundleDir`、`$UnityDataTool` 和 `$NodeScript`，然后运行：

```powershell
& ./converts/zh-CN.ps1
```

该脚本会先导出本地化 bundle，再导出剧情 bundle；每个 bundle 在全新临时目录中处理，收集全部 CAB，并筛选包含 `playlist` 的剧情 dump。它传入 `aliases.json`、`--strict` 及独立报告路径。

- 脚本输出：`$BundleDir/zh-CN/`。
- 本次 dump 和成功转换报告：`$BundleDir/DumpedTxt/<运行ID>/` 下的 `Locale/`、`Scripts/` 与 `Reports/`。
- `$RequireTranslations` 默认 `$true`，缺失翻译会使对应 CAB 失败；设为 `$false` 可回退原文。
- 某个剧情 bundle 失败后会继续处理后续 bundle，最终汇总失败；此时输出可能只是部分结果。

脚本要求 UnityDataTool 支持 `dump <bundle>` 并向当前工作目录输出 `CAB-*.txt`。输出目录不会自动清空；失败后可能保留旧文件。相同脚本路径在多个剧情 bundle 中出现时，后处理的结果会覆盖先前结果，工具不会自动选择最新版本或合并内容。

## 本地化、报告与还原边界

本地化模块按 TextAsset 对象边界读取多行 `m_Script`，从文档头取得完整脚本路径，再解析 `# 文本ID` 分段。空条目视为缺失翻译；同一路径与 ID 对应不同译文时会报冲突。物理换行会折叠为 `<br>`，已有 `<br>` 后的换行不重复添加，以减少脚本行号漂移。

转换报告包含：

| 字段 | 内容 |
| --- | --- |
| `scripts` | 输出文件、行数及对象 pathId |
| `commandCounts` | 序列化命令类计数 |
| `translation` | 应用翻译次数与缺失条目 |
| `voiceAssociations` | 文本 ID、作者与 playbackSpot 的关联线索 |
| `issues` | 缺失引用、缺失文本、不支持的值、重复行等问题 |

请注意以下限制：

- 有 `lines` 数据时按序列化行记录还原；缺失时退回 playlist，并记录问题，无法完整保留标签与注释。`--strict` 会阻止这种降级结果写出。
- 通用 dump 解析器依赖空格缩进，对跨行字符串不具备通用解析能力；本地化模块仅对相应 TextAsset 格式做了专门处理。
- 别名提取器限定了项目相关命名空间与 `dump.cs` 格式，迁移到其他游戏可能需要调整。
- 保留 `|#文本ID|` 和行位置有助于维持自动语音关联，但报告中的线索不是已验证的音频路径，播放仍依赖原项目资源与配置。
- 还原不保证与原始源码逐字一致，也不保证所有自定义命令可直接运行。`zh-CN` 文件夹名不会自动向 Unity 注册语言包。

## 查看 AST 与运行测试

查看 dump 结构：

```powershell
node ./parse-unity-dump.mjs ./story.dump.txt --json ./ast.json
node ./parse-unity-dump.mjs ./story.dump.txt --tree
```

项目附带的测试需要原始样本，且包含固定章节、脚本数量、文本内容及命令映射断言，不能将任意 dump 作为输入：

```powershell
node ./test.mjs ./sample.dump.txt
node ./test-v2.mjs ./dump.cs ./sample1.dump.txt ./sample2.dump.txt
node ./test-localization.mjs ./story.dump.txt ./locale.dump.txt
```

其中 `test.mjs` 预期 14 个脚本；`test-localization.mjs` 预期 44 个脚本与 2796 次文本替换，并读取项目中的 `aliases.json`。运行前需准备匹配样本与别名配置。本包未附带这些原始测试输入，不能仅凭现有文件复现全部测试。
