import fs from 'node:fs';
import path from 'node:path';

/**
 * 解析本地化文本数据
 * 注：TextAsset.m_Script 是跨行字符串，必须按原始对象边界截取，不能用缩进 AST 解析。
 * @param {string} text - Unity 导出的文本资产数据内容
 * @returns {Object} 包含各个脚本及其对应翻译条目的对象
 */
export function parseLocalization(text) {
	const scripts = Object.create(null);

	// 1. 去除 BOM 头，统一换行符，并按 Unity 对象边界分割文本块
	const blocks = text
		.replace(/^\uFEFF/, '')
		.replaceAll('\r\n', '\n')
		.split(/(?=^ID: -?\d+ \(ClassID: \d+\))/m);

	for (const block of blocks) {
		// 仅处理 ClassID 为 49（TextAsset）的对象
		if (!/^ID: -?\d+ \(ClassID: 49\) TextAsset\s*$/m.test(block)) continue;

		// 匹配 m_Script 字段起始位置
		const m = block.match(/^  m_Script \(string\) ?/m);
		if (!m) continue;

		// 截取 m_Script 之后的文档内容
		const doc = block.slice(m.index + m[0].length);

		// 从文档头部的注释中提取脚本路径名称
		const scriptMatch = doc.match(/localization document for '([^']+)' Naninovel scenario script/);
		if (!scriptMatch) {
			const nameMatch = block.match(/^  m_Name \(string\) (.*)$/m);
			throw Error('本地化 TextAsset 缺少 script path: ' + (nameMatch ? nameMatch[1] : '未知名称'));
		}
		const script = scriptMatch[1];

		const entries = scripts[script] ??= Object.create(null);
		let id = null;
		let lines = [];

		/** 将当前缓存的文本条目写入结果对象中 */
		function flush() {
			if (id === null) return;

			// 清除首尾空白行
			while (lines.length && !lines[0].trim()) lines.shift();
			while (lines.length && !lines.at(-1).trim()) lines.pop();

			// 空条目视为未翻译，防止空白覆盖原文
			if (lines.length) {
				let translated = '';
				for (const line of lines) {
					if (translated && !/<br\s*\/?\s*>$/i.test(translated)) {
						translated += '<br>';
					}
					translated += line;
				}

				// 检查是否存在翻译冲突
				if (Object.hasOwn(entries, id) && entries[id] !== translated) {
					throw Error(`翻译冲突: ${script} # ${id}`);
				}
				entries[id] = translated;
			}
		}

		// 逐行解析本地化文件的内容块
		for (const line of doc.split('\n')) {
			const header = line.match(/^#\s+(.+?)\s*$/);
			if (header) {
				flush();       // 遇到新的 ID 标题时，先结算上一个
				id = header[1];
				lines = [];
			} else if (id !== null && !/^\s*;/.test(line)) {
				lines.push(line);
			}
		}
		flush(); // 结算最后一个条目
	}

	return scripts;
}

/**
 * 加载并合并指定路径下的所有本地化文件或单个文件
 * @param {string} input - 文件路径或目录路径
 * @returns {Object} 合并后的所有本地化脚本字典
 */
export function loadLocalization(input) {
	const files = [];

	/** 递归遍历目录收集所有 .txt 文件 */
	function walk(p) {
		const stat = fs.statSync(p);
		if (stat.isDirectory()) {
			const entries = fs.readdirSync(p, { withFileTypes: true })
				.sort((a, b) => a.name.localeCompare(b.name));

			for (const e of entries) {
				if (e.isDirectory() || (e.isFile() && e.name.endsWith('.txt'))) {
					walk(path.join(p, e.name));
				}
			}
		} else {
			files.push(p);
		}
	}

	walk(input);

	const scripts = Object.create(null);

	// 遍历所有收集到的本地化文件进行解析与合并
	for (const file of files) {
		const parsed = parseLocalization(fs.readFileSync(file, 'utf8'));
		for (const [script, entries] of Object.entries(parsed)) {
			const target = scripts[script] ??= Object.create(null);
			for (const [id, text] of Object.entries(entries)) {
				if (Object.hasOwn(target, id) && target[id] !== text) {
					throw Error(`翻译冲突: ${script} # ${id}`);
				}
				target[id] = text;
			}
		}
	}

	if (!Object.keys(scripts).length) {
		throw Error('未找到本地化 TextAsset；--locale 应指向 UnityDataTool 导出的 txt 或其目录');
	}

	return scripts;
}