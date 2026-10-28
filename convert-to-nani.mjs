#!/usr/bin/env node

/**
 * @file convert-to-nani.mjs
 * @description 
 * Node.js >= 18，无第三方依赖。
 * 用于将 Unity 导出数据 (dump) 转换为 Naninovel 脚本格式 (.nani)。
 * 
 * 示例用法：
 *   node convert-to-nani.mjs dump.txt --out nani
 *   node convert-to-nani.mjs dump.txt --out nani --aliases aliases.json --strict
 * 
 * 注意事项：
 * - 默认使用序列化类名/字段名，避免臆测项目自定义 Alias。
 * - aliases.json 示例: {"Gosub":{"command":"gosub","parameters":{"Path":""}}}
 * - 参数别名为空字符串表示无名参数。
 * - --strict 参数会在数据损失或无法还原时抛出异常失败。
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadLocalization } from './localization.mjs';
import {
    parseDump,
    findChild as child,
    findObjects,
    indexManagedReferences,
    extractTextMap,
    getArrayField
} from './parse-unity-dump.mjs';

// ==========================================
// 基础工具辅助函数
// ==========================================

/** 获取子节点的值 */
const val = (n, k) => child(n ?? { children: [] }, k)?.value;

/** 获取所有数组成员元素 */
const elements = n => n?.children.filter(x => x.kind === 'arrayElement') ?? [];

/** 获取引用 ID (rid) */
const rid = n => val(n, 'rid') ?? n?.children.find(x => x.kind === 'ridRef')?.rid;

/** 将节点递归转换为纯对象/基础类型 */
const plain = n => n?.children.length
    ? Object.fromEntries(n.children.map((x, i) => [x.name ?? x.index ?? i, plain(x)]))
    : n?.value ?? '';

/** 对字符串进行引用和转义处理 */
const quote = s => s !== '' && !/[\s"\\\[\]]/.test(s)
    ? s
    : '"' + s.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\r', '').replaceAll('\n', '\\n') + '"';


// ==========================================
// 核心转换逻辑
// ==========================================

/**
 * 将 Unity Dump 文本转换为 Naninovel 脚本格式
 * @param {string} text - Unity Dump 文件内容
 * @param {Object} options - 配置选项
 * @returns {Object} 包含转换后的文件列表及转换报告
 */
export function convertDump(text, { aliases = {}, strict = false, localization = null, requireTranslations = false } = {}) {
    const { nodes } = parseDump(text);
    const files = [];
    const translation = { applied: 0, missing: [] };
    const voiceAssociations = [];
    const issues = [];
    const counts = {};

    // 遍历所有对象节点
    for (const object of findObjects(nodes)) {
        if (!child(object, 'playlist')) continue;

        const script = val(object, 'path') || val(object, 'm_Name');
        const refs = indexManagedReferences(object);
        const texts = extractTextMap(object);

        // 记录警告信息
        const warn = (code, detail, node) => issues.push({ script, code, detail, line: node?.lineNumber });

        // 解析托管引用
        const resolve = id => {
            const n = refs.get(id);
            if (!n) warn('missing-reference', id);
            return n;
        };

        /** 解析原始参数值 */
        function rawValue(param) {
            const arr = getArrayField(child(param, 'raw') ?? { children: [] }, 'parts');
            const parts = elements(arr);
            if (!parts.length) return null;

            return parts.map(p => {
                const id = val(p, 'id');
                const expr = val(p, 'expression');

                if (id) {
                    if (!Object.hasOwn(texts, id)) {
                        warn('missing-text', id, p);
                        return `{MISSING_TEXT_${id}}`;
                    }
                    let content = texts[id] ?? '';
                    if (localization) {
                        if (Object.hasOwn(localization[script] ?? {}, id)) {
                            content = localization[script][id];
                            translation.applied++;
                        } else {
                            translation.missing.push({ script, id });
                        }
                    }
                    return content + `|#${id}|`;
                }

                return expr ? `{${expr}}` : val(p, 'text') ?? '';
            }).join('');
        }

        /** 降级解析复杂类型数据 */
        function fallback(n) {
            if (!n) return '';
            if (n.kind === 'array') return elements(n).map(fallback).join(',');
            if (n.type === 'NullableString' || /^Nullable/.test(n.type ?? '')) {
                return val(n, 'hasValue') === '0' ? '' : fallback(child(n, 'value'));
            }
            if (n.type === 'NamedString' || /^Named(Integer|Decimal|Boolean)/.test(n.type ?? '')) {
                const a = fallback(child(n, 'name'));
                const b = child(n, 'value');
                return a + (val(b, 'hasValue') === '0' ? '' : '.' + fallback(b));
            }

            const arr = n.children.find(x => x.kind === 'array');
            if (arr) return fallback(arr);
            if (n.value !== null) return n.value ?? '';

            const parts = getArrayField(n, 'parts');
            if (parts) return elements(parts).map(p => val(p, 'text') ?? '').join('');

            if (n.children.length) {
                warn('unsupported-value', JSON.stringify(plain(n)), n);
                return '';
            }
            return '';
        }

        /** 将引用转换为 Naninovel 命令 */
        function command(ref, inline = false) {
            if (!ref) return inline ? '[MISSING_REFERENCE]' : '; MISSING_REFERENCE';

            const cls = val(child(ref, 'type'), 'class');
            const data = child(ref, 'data');
            counts[cls] = (counts[cls] ?? 0) + 1;

            // 提取语音关联线索
            if (cls === 'PrintTextModified' || cls === 'PrintText') {
                const textParam = child(data, 'Text');
                const parts = elements(getArrayField(child(textParam ?? { children: [] }, 'raw') ?? { children: [] }, 'parts'));
                const spot = child(data, 'playbackSpot');

                voiceAssociations.push({
                    script,
                    lineIndex: Number(val(spot, 'lineIndex')),
                    inlineIndex: Number(val(spot, 'inlineIndex')),
                    textIds: parts.map(p => val(p, 'id')).filter(Boolean),
                    authorId: val(child(data, 'AuthorId'), 'value') ?? '',
                    note: '自动语音关联线索；不是已验证的音频路径'
                });
            }

            const config = aliases[(val(child(ref, 'type'), 'ns') ?? '') + '.' + cls] ?? aliases[cls] ?? {};
            const name = config.command ?? cls;
            const args = [];
            const primary = [];

            for (const p of data.children) {
                if (!p.type?.endsWith('Parameter') || val(p, 'hasValue') !== '1') continue;

                let value = rawValue(p);
                if (value === null) {
                    value = fallback(child(p, 'value'));
                    if (p.type === 'BooleanParameter') value = value === '1' ? 'true' : 'false';
                }

                const key = config.parameters?.[p.name] ?? p.name;
                (key === '' ? primary : args).push(key === '' ? quote(value) : `${key}:${quote(value)}`);
            }

            if (primary.length > 1) warn('multiple-primary', cls, ref);

            const body = [name, ...primary, ...args].join(' ');
            return inline ? `[${body}]` : `@${body}`;
        }

        const arr = getArrayField(object, 'lines');
        let lines = [];

        if (arr) {
            const records = elements(arr)
                .map(e => resolve(rid(e)))
                .filter(Boolean)
                .map(ref => ({
                    ref,
                    data: child(ref, 'data'),
                    cls: val(child(ref, 'type'), 'class')
                }));

            // 按行索引排序
            records.sort((a, b) => Number(val(a.data, 'lineIndex')) - Number(val(b.data, 'lineIndex')));

            const seen = new Set();
            for (const { ref, data, cls } of records) {
                const index = Number(val(data, 'lineIndex'));
                if (!Number.isSafeInteger(index) || index < 0 || index > 1000000) {
                    throw Error('Invalid lineIndex: ' + index);
                }
                if (seen.has(index)) warn('duplicate-line', String(index), ref);
                seen.add(index);

                while (lines.length <= index) lines.push('');

                const indent = Number(val(data, 'indent') ?? 0);
                if (!Number.isSafeInteger(indent) || indent < 0 || indent > 100) {
                    throw Error('Invalid indent');
                }

                let s = '';
                if (cls === 'CommandScriptLine') {
                    s = command(resolve(rid(child(data, 'command'))));
                } else if (cls === 'GenericTextScriptLine') {
                    s = elements(getArrayField(data, 'inlinedCommands'))
                        .map(e => command(resolve(rid(e)), true))
                        .join('');
                } else if (cls === 'LabelScriptLine') {
                    s = '# ' + (val(data, 'labelText') ?? '');
                } else if (cls === 'CommentScriptLine') {
                    s = '; ' + (val(data, 'commentText') ?? '');
                } else if (cls !== 'EmptyScriptLine') {
                    warn('unknown-line', cls, ref);
                    s = '; UNHANDLED ' + cls;
                }

                // 使用 4 个空格作为缩进
                lines[index] = '    '.repeat(indent) + s;
            }
        } else {
            warn('missing-lines', '按 playlist 恢复，无法保留注释和标签', object);
            lines = elements(getArrayField(child(object, 'playlist'), 'commands'))
                .map(e => command(resolve(rid(e))));
        }

        // 路径安全校验
        const safe = String(script).replaceAll('\\', '/');
        if (path.posix.isAbsolute(safe) || safe.split('/').some(s => s === '..' || s === '.' || !s) || /[:\x00-\x1f]/.test(safe)) {
            throw Error('Unsafe script path: ' + script);
        }

        const filename = safe + '.nani';
        if (files.some(f => f.filename === filename)) {
            throw Error('Duplicate output: ' + filename);
        }

        files.push({
            filename,
            content: lines.join('\n') + '\n',
            lineCount: lines.length,
            pathId: object.pathId
        });
    }

    // 最终状态及约束检查
    if (!files.length) throw Error('未找到包含 playlist 的脚本对象');
    if (requireTranslations && translation.missing.length) throw Error('缺少翻译: ' + JSON.stringify(translation.missing));
    if (strict && issues.length) throw Error('Strict conversion failed: ' + JSON.stringify(issues));

    return {
        files,
        report: {
            scripts: files.map(({ content, ...f }) => f),
            commandCounts: counts,
            translation,
            voiceAssociations,
            issues,
            mode: 'class-and-field-names',
            note: '保留文本 ID 以维持自动语音关联。别名由 aliases.json 提供；未映射类使用类名。'
        }
    };
}


// ==========================================
// CLI 命令行入口逻辑
// ==========================================

function main() {
    const args = process.argv.slice(2);
    const input = args.shift();
    let out = 'nani';
    let aliases = {};
    let strict = false;
    let localization = null;
    let requireTranslations = false;
    let reportPath = null;

    // 显示帮助说明
    if (!input || input === '--help') {
        console.log('node convert-to-nani.mjs dump.txt [--out nani] [--aliases aliases.json] [--locale locale-dumps] [--require-translations] [--report report.json] [--strict]');
        return;
    }

    // 解析命令行参数
    while (args.length) {
        const a = args.shift();
        if (a === '--strict') {
            strict = true;
        } else if (a === '--require-translations') {
            requireTranslations = true;
        } else if (['--out', '--aliases', '--locale', '--report'].includes(a)) {
            const v = args.shift();
            if (!v || v.startsWith('--')) throw Error('Missing value: ' + a);

            if (a === '--out') out = v;
            else if (a === '--locale') localization = loadLocalization(v);
            else if (a === '--report') reportPath = v;
            else aliases = JSON.parse(fs.readFileSync(v, 'utf8'));
        } else {
            throw Error('Unknown option: ' + a);
        }
    }

    if (requireTranslations && !localization) {
        throw Error('--require-translations 需要 --locale');
    }

    // 执行转换
    const { files, report } = convertDump(fs.readFileSync(input, 'utf8'), {
        aliases,
        strict,
        localization,
        requireTranslations
    });

    // 写入转换后的脚本文件
    for (const f of files) {
        const target = path.join(out, f.filename);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, f.content);
    }

    // 写入转换报告
    fs.mkdirSync(out, { recursive: true });
    const targetReport = reportPath ?? path.join(out, 'conversion-report.json');
    fs.mkdirSync(path.dirname(targetReport), { recursive: true });
    fs.writeFileSync(targetReport, JSON.stringify(report, null, 2));

    console.log(`Converted ${files.length} scripts; ${report.issues.length} issues; translated ${report.translation.applied}, missing ${report.translation.missing.length} -> ${out}`);
}

// 如果作为独立脚本直接运行，则执行 main 函数
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        main();
    } catch (e) {
        console.error(e.message);
        process.exitCode = 1;
    }
}