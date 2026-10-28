#!/usr/bin/env node

/**
 * @file extract-aliases.mjs
 * @description
 * 用于从 C# 源码/Dump 文件中提取 Naninovel 命令及其参数别名映射。
 * 
 * 示例用法：
 *   node extract-aliases.mjs dump.cs aliases.json
 */

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/**
 * 从 C# 文本中提取命令别名与参数映射
 * @param {string} text - C# Dump 文件内容
 * @returns {Object} 包含所有类、命令及参数别名的映射对象
 */
export function extractAliases(text) {
    const classes = new Map();

    // 按命名空间拆分并遍历代码块
    for (const block of text.split(/^\/\/ Namespace: /m).slice(1)) {
        // 过滤并仅处理指定的命名空间
        if (!/^(?:Naninovel(?:\.Commands)?|WitchTrials\.Views|GigaCreation\.NaninovelExtender(?:\.\w+)*)\r?$/.test(block.split('\n')[0])) {
            continue;
        }

        // 匹配 C# 类声明（获取类名及基类）
        const match = block.match(/^(?:public|internal|private|protected)(?: sealed| abstract| static| partial)* class (\w+)(?:<[^>\r\n]*>)?(?: : ([^\r\n/]+))? \/\/ TypeDefIndex:/m);
        if (!match) continue;

        const name = match[1];
        const base = match[2]?.split(/[<,]/)[0].trim();
        const prefix = block.slice(0, match.index);

        // 匹配类上的 [CommandAlias("...")] 特性
        const alias = prefix.match(/\[CommandAlias\("((?:\\.|[^"\\])*)"\)\]/);

        // 提取字段区域（排除方法和属性部分）
        const fields = block.slice(match.index + match[0].length).split('// Methods')[0].split('// Properties')[0];
        const parameters = {};
        let attrs = '';

        // 逐行解析字段及其 [ParameterAlias] 特性
        for (const line of fields.split(/\r?\n/)) {
            if (/^\s*\[/.test(line)) {
                attrs += line;
                continue;
            }
            const field = line.match(/^\s*public\s+\w+Parameter\s+(\w+);/);
            if (field) {
                const a = attrs.match(/\[ParameterAlias\("((?:\\.|[^"\\])*)"\)\]/);
                if (a) {
                    parameters[field[1]] = JSON.parse('"' + a[1] + '"');
                }
            }
            if (line.trim() && !line.trim().startsWith('//')) {
                attrs = '';
            }
        }

        const ns = block.split('\n')[0].trim();
        const key = ns + '.' + name;

        classes.set(key, {
            name,
            ns,
            base,
            command: alias ? JSON.parse('"' + alias[1] + '"') : name,
            parameters
        });
    }

    /** 获取指定类的父类全名 */
    function parent(c) {
        if (!c.base) return null;
        if (c.base === 'Command') return 'Naninovel.Command';
        if (classes.has(c.ns + '.' + c.base)) return c.ns + '.' + c.base;
        if (classes.has('Naninovel.Commands.' + c.base)) return 'Naninovel.Commands.' + c.base;

        const matches = [...classes].filter(([k, v]) => v.name === c.base);
        if (matches.length > 1) throw Error('Ambiguous base: ' + c.base);
        return matches[0]?.[0];
    }

    /** 递归收集继承链上的参数映射 */
    function collect(key, seen = new Set()) {
        if (!key) return {};
        if (seen.has(key)) throw Error('Inheritance cycle');
        seen.add(key);

        const c = classes.get(key);
        const inherited = collect(parent(c), seen);

        if (Object.values(c.parameters).includes('')) {
            for (const k of Object.keys(inherited)) {
                if (inherited[k] === '') inherited[k] = k;
            }
        }
        return { ...inherited, ...c.parameters };
    }

    const result = {};
    for (const [key, c] of classes) {
        let cur = key;
        const seen = new Set();
        while (cur && !seen.has(cur)) {
            seen.add(cur);
            const item = classes.get(cur);
            // 如果继承链追溯到 Command 基类，则收录该命令映射
            if (item.base === 'Command') {
                result[key] = {
                    command: c.command,
                    parameters: collect(key)
                };
                break;
            }
            cur = parent(item);
        }
    }

    return result;
}


// ==========================================
// CLI 命令行入口逻辑
// ==========================================

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const [input, out = 'aliases.json'] = process.argv.slice(2);

    if (!input) {
        throw Error('用法错误: node extract-aliases.mjs dump.cs aliases.json');
    }

    // 读取并提取别名
    const aliases = extractAliases(fs.readFileSync(input, 'utf8'));

    // 写入生成的 JSON 文件
    fs.writeFileSync(out, JSON.stringify(aliases, null, 2));
    console.log(`成功提取 ${Object.keys(aliases).length} 个命令映射规则`);
}