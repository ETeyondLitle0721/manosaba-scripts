#!/usr/bin/env node
/**
 * extract-nani-text.js
 *
 * 递归读取 D:\Workspace\Visual-Studio-Code\manosaba-scripts\scripts 下的所有 .nani 文件，
 * 提取 [PrintTextModified Text:... AuthorId:... ] 中的剧情文本，
 * 标注说话者（AuthorId 有值则用其值，否则视为旁白 NAR；Unknown 记为 UNK），
 * 输出到 D:\Workspace\Visual-Studio-Code\manosaba-scripts\contents 下对应目录，.txt 格式。
 *
 * 规则：
 *  - 无任何提取行的文件不输出
 *  - 去除文本末尾的 |...| 标识符（如 |#0101Adv02_Ema001|）
 *  - 每行 trim
 *  - 输出格式: AuthorId: Content
 *  - AuthorId 缺省 => NAR；AuthorId === "Unknown" => UNK
 */

const fs = require('fs');
const path = require('path');

// ===== 可配置路径 =====
const SCRIPTS_DIR = 'D:\\Workspace\\Visual-Studio-Code\\manosaba-scripts\\scripts';
const CONTENTS_DIR = 'D:\\Workspace\\Visual-Studio-Code\\manosaba-scripts\\contents';

/**
 * 递归收集所有 .nani 文件
 */
function collectNaniFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    console.warn(`无法读取目录: ${dir} (${e.message})`);
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectNaniFiles(full, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.nani')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 从一行文本中解析出字段（支持带引号的值、花括号值、普通 token）
 * 返回 { Text, AuthorId } 或 null
 */
function parsePrintTextLine(line) {
  const headMatch = line.match(/^\s*\[PrintTextModified\b/);
  if (!headMatch) return null;

  let body = line.trim();
  if (body.endsWith(']')) body = body.slice(0, -1);
  body = body.replace(/^\s*\[PrintTextModified\b/, '').trim();

  const fields = {};
  let i = 0;
  const len = body.length;

  while (i < len) {
    while (i < len && /\s/.test(body[i])) i++;
    if (i >= len) break;

    let keyStart = i;
    while (i < len && body[i] !== ':' && !/\s/.test(body[i])) i++;
    if (i >= len || body[i] !== ':') {
      while (i < len && !/\s/.test(body[i])) i++;
      continue;
    }
    const key = body.slice(keyStart, i);
    i++; // skip ':'

    let value = '';
    if (body[i] === '"') {
      i++;
      let buf = '';
      while (i < len) {
        const ch = body[i];
        if (ch === '\\' && i + 1 < len) {
          buf += ch + body[i + 1];
          i += 2;
        } else if (ch === '"') {
          i++;
          break;
        } else {
          buf += ch;
          i++;
        }
      }
      value = buf;
    } else if (body[i] === '{') {
      let depth = 0;
      let buf = '';
      while (i < len) {
        const ch = body[i];
        buf += ch;
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
        i++;
      }
      value = buf;
    } else {
      let buf = '';
      while (i < len && !/\s/.test(body[i])) {
        buf += body[i];
        i++;
      }
      value = buf;
    }

    fields[key] = value;
  }

  if (!('Text' in fields)) return null;
  return {
    text: fields.Text,
    authorId: fields.AuthorId || null,
  };
}

/**
 * 去除文本末尾的 |...|（例如 |#0101Adv02_Ema001|）
 * 可能出现在 trim 之后
 */
function stripTrailingPipeSuffix(text) {
  // 匹配末尾的 |...| （不含换行），允许有多个
  let t = text;
  // 反复剥离末尾的 |...|
  // 只剥离紧贴在文本末尾的 |...| 片段（|...| 中间不含 |）
  while (/\|[^|]*\|\s*$/.test(t)) {
    t = t.replace(/\|[^|]*\|\s*$/, '').trimEnd();
  }
  return t;
}

/**
 * 处理单个 .nani 文件，返回 txt 内容字符串（可能为空）
 */
function processNaniFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  const outLines = [];
  for (const line of lines) {
    const parsed = parsePrintTextLine(line);
    if (!parsed) continue;

    // 1) 去尾部 |...|
    let text = stripTrailingPipeSuffix(parsed.text);
    // 2) trim
    text = text.trim();

    // 说话者
    let speaker;
    if (!parsed.authorId) {
      speaker = 'NAR';
    } else if (parsed.authorId === 'Unknown') {
      speaker = 'UNK';
    } else {
      speaker = parsed.authorId;
    }

    // 空文本也跳过（避免输出 "XXX: " 这种无意义的行）
    if (text.length === 0) continue;

    outLines.push(`${speaker}: ${text}`);
  }

  if (outLines.length === 0) return null;
  return outLines.join('\n') + '\n';
}

/**
 * 主流程
 */
function main() {
  if (!fs.existsSync(SCRIPTS_DIR)) {
    console.error(`脚本目录不存在: ${SCRIPTS_DIR}`);
    process.exit(1);
  }

  const files = collectNaniFiles(SCRIPTS_DIR);
  console.log(`共找到 ${files.length} 个 .nani 文件`);

  let okCount = 0;
  let skippedCount = 0;
  let failCount = 0;

  for (const file of files) {
    try {
      const rel = path.relative(SCRIPTS_DIR, file);
      const relDir = path.dirname(rel);
      const baseName = path.basename(rel, path.extname(rel));
      const outDir = path.join(CONTENTS_DIR, relDir);
      const outFile = path.join(outDir, baseName + '.txt');

      const txt = processNaniFile(file);

      // 无任何行 => 不输出
      if (txt === null) {
        console.log(`- 跳过(无内容): ${rel}`);
        skippedCount++;
        continue;
      }

      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outFile, txt.replaceAll("<br>", " "), 'utf8');

      console.log(`✔ ${rel} -> ${path.relative(CONTENTS_DIR, outFile)}`);
      okCount++;
    } catch (e) {
      console.error(`✘ 处理失败: ${file}\n  ${e.message}`);
      failCount++;
    }
  }

  console.log(
    `\n完成: 成功 ${okCount} 个, 跳过(无内容) ${skippedCount} 个, 失败 ${failCount} 个`
  );
}

main();