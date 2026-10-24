# Unity MonoBehaviour dump → Naninovel .nani

Node.js 18+，不需要 npm install。基于随附 parse-unity-dump.mjs 二次开发。

```bash
node convert-to-nani.mjs CAB-b2d3e8.dump.txt --out nani --strict
node convert-to-nani.mjs CAB-b2d3e8.dump.txt --out nani --aliases aliases.example.json
node test.mjs CAB-b2d3e8.dump.txt
```

测试命令针对本次 CAB 样本；压缩包未重复收录 9 MB 原始 dump，使用你原来的文件路径即可。

## 输出与恢复方式

- 按对象 path 保留目录，每个脚本输出一个 .nani。
- 按 lines 的 lineIndex 恢复空行、注释、标签、缩进；通过对象内 references 解析命令和内联命令。RID、PathID 始终保留字符串，避免 64 位整数精度损失。
- GenericTextScriptLine 输出 `[PrintTextModified Text:... AuthorId:... ...]`，而不是只输出台词，以保留打印机、等待、追加等参数。它是可编辑的脚本表达，不是原始源码逐字复原。
- 优先读取 raw.parts：text 原样恢复；expression 转为 `{表达式}`；id 从当前对象 textMap 查找。保留 `<br>`、ruby 等富文本。
- hasValue=0 的参数省略；raw 为空但 hasValue=1 时，从 value 恢复编译后的值（包括 true/false、列表和命名值）。因此会比原文多出显式默认参数。
- conversion-report.json 记录脚本、命令计数和问题。--strict 在缺失文本、引用、未知行或不支持值等情况失败，不写出新结果。
- 修复原解析器 getCommandRids：同时支持 `rid (SInt64)` 和 `rid(...)`。

## 命令名称与运行限制

dump 中没有 C# `[Alias]` 元数据，不能可靠推出自定义命令的简写。本工具默认保留完整类名、字段名，例如：

```nani
@Gosub Path:System/System_Subroutine.BeginAdv
@ModifyCharacterExtended Lazy:false ScenePosition:50 IdAndAppearance:Margo.Normal1
[PrintTextModified Text:こんにちは AuthorId:Margo RevealSpeed:1 WaitForInput:true Wait:true]
```

Naninovel 文档允许按类名调用命令、按字段名传入参数；但本游戏所用版本、覆盖内置命令的注册冲突，仍需在原 Unity 项目导入验证。`aliases.example.json` 展示如何改用已确认的 Alias（空字符串表示无名参数）；它不是本游戏全部别名的已验证映射。可从 Assembly-CSharp / 扩展程序集的反编译代码中补齐。使用工具不会把自定义命令自动转换为标准 Naninovel 的等价实现。

本次样本：14 个脚本、3085 行、1577 条命令，严格模式无问题。已校验 playlist 命令总数与输出命令总数一致，并检查标签行号、台词、作者、表达式、别名覆盖、非法路径及缺失引用。未在 Unity/Naninovel 引擎中运行；运行还依赖原游戏自定义命令、角色/音频/UI 资源、System 子脚本及变量。

基础 dump 格式本身未提供字符串长度或转义边界。若其他 dump 包含实际跨行字符串、伪装成字段的文本，现有缩进解析无法保证无歧义还原；本次样本未发现对象内部 unknown 节点。默认四个空格表示一级脚本缩进，无法还原原始空格数量。文本 ID 被展开为当前文本，原始本地化 ID 标记未写回 .nani；原始 ID 仍在源 dump。

参考：https://naninovel.com/guide/custom-commands ，https://naninovel.com/guide/scenario-scripting 。
