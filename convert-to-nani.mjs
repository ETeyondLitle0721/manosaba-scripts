#!/usr/bin/env node
/**
 * Node.js >= 18，无第三方依赖。
 * node convert-to-nani.mjs dump.txt --out nani
 * node convert-to-nani.mjs dump.txt --out nani --aliases aliases.json --strict
 * 默认使用序列化类名/字段名，避免臆测项目自定义 Alias。
 * aliases.json: {"Gosub":{"command":"gosub","parameters":{"Path":""}}}
 * 参数别名为空字符串表示无名参数。--strict 在数据损失/无法还原时失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseDump, findChild as child, findObjects, indexManagedReferences, extractTextMap, getArrayField } from './parse-unity-dump.mjs';
const val = (n, k) => child(n ?? { children: [] }, k)?.value;
const elements = n => n?.children.filter(x => x.kind === 'arrayElement') ?? [];
const rid = n => val(n, 'rid') ?? n?.children.find(x => x.kind === 'ridRef')?.rid;
const plain = n => n?.children.length ? Object.fromEntries(n.children.map((x, i) => [x.name ?? x.index ?? i, plain(x)])) : n?.value ?? '';
const quote = s => s !== '' && !/[\s"\\\[\]]/.test(s) ? s : '"' + s.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\r', '').replaceAll('\n', '\\n') + '"';

export function convertDump(text, { aliases = {}, strict = false } = {}) {
    const { nodes } = parseDump(text); const files = []; const issues = []; const counts = {};
    for (const object of findObjects(nodes)) {
        if (!child(object, 'playlist')) continue;
        const script = val(object, 'path') || val(object, 'm_Name');
        const refs = indexManagedReferences(object), texts = extractTextMap(object);
        const warn = (code, detail, node) => issues.push({ script, code, detail, line: node?.lineNumber });
        const resolve = id => { const n = refs.get(id); if (!n) warn('missing-reference', id); return n; };
        function rawValue(param) {
            const arr = getArrayField(child(param, 'raw') ?? { children: [] }, 'parts');
            const parts = elements(arr);
            if (!parts.length) return null;
            return parts.map(p => {
                const id = val(p, 'id'), expr = val(p, 'expression');
                if (id) { if (!Object.hasOwn(texts, id)) { warn('missing-text', id, p); return `{MISSING_TEXT_${id}}`; } return texts[id] ?? ''; }
                return expr ? `{${expr}}` : val(p, 'text') ?? '';
            }).join('');
        }
        function fallback(n) {
            if (!n) return '';
            if (n.kind === 'array') return elements(n).map(fallback).join(',');
            if (n.type === 'NullableString' || /^Nullable/.test(n.type ?? '')) return val(n, 'hasValue') === '0' ? '' : fallback(child(n, 'value'));
            if (n.type === 'NamedString' || /^Named(Integer|Decimal|Boolean)/.test(n.type ?? '')) {
                const a = fallback(child(n, 'name')), b = child(n, 'value'); return a + (val(b, 'hasValue') === '0' ? '' : '.' + fallback(b));
            }
            const arr = n.children.find(x => x.kind === 'array'); if (arr) return fallback(arr);
            if (n.value !== null) return n.value ?? '';
            const parts = getArrayField(n, 'parts'); if (parts) return elements(parts).map(p => val(p, 'text') ?? '').join('');
            if (n.children.length) { warn('unsupported-value', JSON.stringify(plain(n)), n); return ''; }
            return '';
        }
        function command(ref, inline = false) {
            if (!ref) return inline ? '[MISSING_REFERENCE]' : '; MISSING_REFERENCE';
            const cls = val(child(ref, 'type'), 'class'), data = child(ref, 'data');
            counts[cls] = (counts[cls] ?? 0) + 1;
            const config = aliases[cls] ?? {}, name = config.command ?? cls;
            const args = [], primary = [];
            for (const p of data.children) {
                if (!p.type?.endsWith('Parameter') || val(p, 'hasValue') !== '1') continue;
                let value = rawValue(p);
                if (value === null) { value = fallback(child(p, 'value')); if (p.type === 'BooleanParameter') value = value === '1' ? 'true' : 'false'; }
                const key = config.parameters?.[p.name] ?? p.name;
                (key === '' ? primary : args).push(key === '' ? quote(value) : `${key}:${quote(value)}`);
            }
            if (primary.length > 1) warn('multiple-primary', cls, ref);
            const body = [name, ...primary, ...args].join(' ');
            return inline ? `[${body}]` : `@${body}`;
        }
        const arr = getArrayField(object, 'lines'); let lines = [];
        if (arr) {
            const records = elements(arr).map(e => resolve(rid(e))).filter(Boolean).map(ref => ({ ref, data: child(ref, 'data'), cls: val(child(ref, 'type'), 'class') }));
            records.sort((a, b) => Number(val(a.data, 'lineIndex')) - Number(val(b.data, 'lineIndex')));
            const seen = new Set;
            for (const { ref, data, cls } of records) {
                const index = Number(val(data, 'lineIndex'));
                if (!Number.isSafeInteger(index) || index < 0 || index > 1000000) throw Error('Invalid lineIndex: ' + index);
                if (seen.has(index)) warn('duplicate-line', String(index), ref); seen.add(index);
                while (lines.length <= index) lines.push('');
                const indent = Number(val(data, 'indent') ?? 0);
                if (!Number.isSafeInteger(indent) || indent < 0 || indent > 100) throw Error('Invalid indent');
                let s = '';
                if (cls === 'CommandScriptLine') s = command(resolve(rid(child(data, 'command'))));
                else if (cls === 'GenericTextScriptLine') s = elements(getArrayField(data, 'inlinedCommands')).map(e => command(resolve(rid(e)), true)).join('');
                else if (cls === 'LabelScriptLine') s = '# ' + (val(data, 'labelText') ?? '');
                else if (cls === 'CommentScriptLine') s = '; ' + (val(data, 'commentText') ?? '');
                else if (cls !== 'EmptyScriptLine') { warn('unknown-line', cls, ref); s = '; UNHANDLED ' + cls; }
                lines[index] = '    '.repeat(indent) + s;
            }
        } else {
            warn('missing-lines', '按 playlist 恢复，无法保留注释和标签', object);
            lines = elements(getArrayField(child(object, 'playlist'), 'commands')).map(e => command(resolve(rid(e))));
        }
        const safe = String(script).replaceAll('\\', '/');
        if (path.posix.isAbsolute(safe) || safe.split('/').some(s => s === '..' || s === '.' || !s) || /[:\x00-\x1f]/.test(safe)) throw Error('Unsafe script path: ' + script);
        const filename = safe + '.nani'; if (files.some(f => f.filename === filename)) throw Error('Duplicate output: ' + filename);
        files.push({ filename, content: lines.join('\n') + '\n', lineCount: lines.length, pathId: object.pathId });
    }
    if (!files.length) throw Error('未找到包含 playlist 的脚本对象');
    if (strict && issues.length) throw Error('Strict conversion failed: ' + JSON.stringify(issues));
    return { files, report: { scripts: files.map(({ content, ...f }) => f), commandCounts: counts, issues, mode: 'class-and-field-names', note: '类/参数 Alias 不在 dump 中。默认使用类名和字段名；需在原项目验证命令注册规则，或用 aliases.json 覆盖。' } };
}
function main() {
    const args = process.argv.slice(2); const input = args.shift(); let out = 'nani', aliases = {}, strict = false;
    if (!input || input === '--help') { console.log('node convert-to-nani.mjs dump.txt [--out nani] [--aliases aliases.json] [--strict]'); return; }
    while (args.length) { const a = args.shift(); if (a === '--strict') strict = true; else if (a === '--out' || a === '--aliases') { const v = args.shift(); if (!v || v.startsWith('--')) throw Error('Missing value: ' + a); if (a === '--out') out = v; else aliases = JSON.parse(fs.readFileSync(v, 'utf8')); } else throw Error('Unknown option: ' + a); }
    const { files, report } = convertDump(fs.readFileSync(input, 'utf8'), { aliases, strict });
    for (const f of files) { const target = path.join(out, f.filename); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, f.content); }
    fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'conversion-report.json'), JSON.stringify(report, null, 2));
    console.log(`Converted ${files.length} scripts; ${report.issues.length} issues -> ${out}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) { try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; } }
