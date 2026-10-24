#!/usr/bin/env node
// parse-unity-dump.mjs
//
// 解析 UnityDataTool (binary2text 风格) 的 dump 文本为 AST。
// 格式假设：
//   1) 以缩进（空格）表示层级；
//   2) 行形态包括：
//        ID: <pathId> (ClassID: <n>) <TypeName>
//        <name> (<Type>) <value>
//        <name> (<Type>)
//        <name> <TypeName>
//        Array<T>[N]
//        data[i] (<Type>) <value>
//        rid(N) <TypeName>
//   3) 多个对象之间用双换行分隔，每个对象头缩进为 0；
//   4) 字符串值不做转义处理（若出现换行会被误切，需要后续增强）。
//
// 用法：
//   node parse-unity-dump.mjs dump.txt
//   node parse-unity-dump.mjs dump.txt --json ast.json

import fs from 'node:fs';

const TRAILING_WS = /[ \t]+$/;

function splitIndent(line) {
  const m = line.match(/^ */);
  const indent = m ? m[0].length : 0;
  const content = line.slice(indent).replace(TRAILING_WS, '');
  return { indent, content };
}

function analyzeLine(content) {
  if (!content) return null;

  // 1) 对象头：ID: -8122... (ClassID: 114) MonoBehaviour
  let m = content.match(/^ID:\s*(-?\d+)\s*\(ClassID:\s*(\d+)\)\s+(.*)$/);
  if (m) {
    return {
      kind: 'object',
      pathId: m[1],
      classId: m[2],
      type: m[3].trim(),
      name: null,
      value: null,
    };
  }

  // 2) 引用条目：rid(1000) ReferencedObject
  m = content.match(/^rid\((\d+)\)\s+(\S+)$/);
  if (m) {
    return {
      kind: 'ridRef',
      rid: m[1],
      type: m[2],
      name: null,
      value: m[1],
    };
  }

  // 3) 数组声明：Array<managedRefArrayItem>[263]
  m = content.match(/^Array<(.+)>\[(\d+)\]$/);
  if (m) {
    return {
      kind: 'array',
      type: `Array<${m[1]}>`,
      elementType: m[1],
      length: Number(m[2]),
      name: null,
      value: null,
    };
  }

  // 4) 数组元素：data[0] (string) value
  m = content.match(/^data\[(\d+)\]\s+\(([^)]+)\)(?: (.*))?$/);
  if (m) {
    return {
      kind: 'arrayElement',
      index: Number(m[1]),
      type: m[2].trim(),
      name: null,
      value: m[3] ?? null,
    };
  }

  // 5) 有类型括号的字段：m_Enabled (UInt8) 1 / textMap (ScriptTextMap)
  m = content.match(/^([^\s(]+)\s+\(([^)]+)\)(?: (.*))?$/);
  if (m) {
    return {
      kind: 'field',
      name: m[1],
      type: m[2].trim(),
      value: m[3] ?? null,
    };
  }

  // 6) 无括号的复合字段：data ReferencedObjectData
  m = content.match(/^([^\s]+)\s+([A-Za-z_][\w.<>\[\], ]*?)$/);
  if (m) {
    return {
      kind: 'field',
      name: m[1],
      type: m[2].trim(),
      value: null,
    };
  }

  return { kind: 'unknown', raw: content, name: null, type: null, value: null };
}

function pathSegment(desc) {
  switch (desc.kind) {
    case 'object':
      return desc.type ?? '<object>';
    case 'array':
      return desc.type;
    case 'arrayElement':
      return `[${desc.index}]`;
    case 'ridRef':
      return `rid(${desc.rid})`;
    case 'field':
      return desc.name ?? '<anon>';
    default:
      return '<unknown>';
  }
}

export function parseDump(text) {
  const lines = text.split(/\r?\n/);
  const root = {
    id: 0,
    kind: 'root',
    name: null,
    type: null,
    value: null,
    children: [],
    indent: -1,
    lineNumber: 0,
    path: [],
  };
  const stack = [{ node: root, indent: -1 }];
  const nodes = [];
  let nextId = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const { indent, content } = splitIndent(lines[i]);
    if (!content) continue;

    const desc = analyzeLine(content);
    if (!desc) continue;

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].node;

    const node = {
      id: ++nextId,
      ...desc,
      indent,
      lineNumber,
      children: [],
      path: [...parent.path, pathSegment(desc)],
    };

    parent.children.push(node);
    nodes.push(node);
    stack.push({ node, indent });
  }

  return { root, nodes };
}

// ---------- 辅助函数 ----------

export function findObjects(nodes) {
  return nodes.filter((n) => n.kind === 'object');
}

export function findChild(node, name) {
  return node.children.find((c) => c.name === name) ?? null;
}

export function findChildren(node, name) {
  return node.children.filter((c) => c.name === name);
}

export function getArrayField(node, name) {
  const field = findChild(node, name);
  if (!field) return null;
  return field.children.find((c) => c.kind === 'array') ?? null;
}

export function getArrayValues(node, name) {
  const arr = getArrayField(node, name);
  if (!arr) return [];
  return arr.children
    .filter((c) => c.kind === 'arrayElement')
    .map((c) => c.value);
}

export function indexManagedReferences(objectNode) {
  const refsNode = findChild(objectNode, 'references');
  const map = new Map();
  if (!refsNode) return map;
  for (const child of refsNode.children) {
    if (child.kind === 'ridRef') map.set(child.rid, child);
  }
  return map;
}

export function getCommandRids(objectNode) {
  const playlist = findChild(objectNode, 'playlist');
  if (!playlist) return [];
  const commandsField = findChild(playlist, 'commands');
  if (!commandsField) return [];
  const arr = commandsField.children.find((c) => c.kind === 'array');
  if (!arr) return [];
  const rids = [];
  for (const el of arr.children) {
    if (el.kind !== 'arrayElement') continue;
    const rid = el.children.find((c) => c.kind === 'ridRef' || c.name === 'rid');
    if (rid) rids.push(rid.rid ?? rid.value);
  }
  return rids;
}

export function extractTextMap(objectNode) {
  const textMap = findChild(objectNode, 'textMap');
  if (!textMap) return {};
  const idToText = findChild(textMap, 'idToText');
  if (!idToText) return {};
  const keys = getArrayValues(idToText, 'keys');
  const values = getArrayValues(idToText, 'values');
  const map = {};
  const n = Math.min(keys.length, values.length);
  for (let i = 0; i < n; i++) map[keys[i]] = values[i];
  return map;
}

export function formatTree(node, depth = 0, out = []) {
  const indent = '  '.repeat(depth);
  let header;
  if (node.kind === 'object') {
    header = `${indent}[Object pathId=${node.pathId} classId=${node.classId} type=${node.type}]`;
  } else if (node.kind === 'array') {
    header = `${indent}${node.name ?? ''} ${node.type} (len=${node.length})`;
  } else if (node.kind === 'ridRef') {
    header = `${indent}rid(${node.rid}) ${node.type}`;
  } else {
    const typePart = node.type ? ` (${node.type})` : '';
    const valuePart = node.value != null && node.value !== '' ? ` = ${node.value}` : '';
    header = `${indent}${node.name ?? ''}${typePart}${valuePart}`;
  }
  out.push(header);
  for (const child of node.children) formatTree(child, depth + 1, out);
  return out;
}

// ---------- CLI ----------

function main() {
  const args = process.argv.slice(2);
  const input = args[0];
  if (!input) {
    console.error('Usage: node parse-unity-dump.mjs <input.txt> [--json out.json] [--tree]');
    process.exit(1);
  }

  const text = fs.readFileSync(input, 'utf8');
  const { root, nodes } = parseDump(text);

  const byKind = {};
  for (const n of nodes) byKind[n.kind] = (byKind[n.kind] || 0) + 1;
  console.log(`Parsed ${nodes.length} nodes`);
  console.log('By kind:', byKind);

  const objects = findObjects(nodes);
  console.log(`Objects: ${objects.length}`);
  for (const o of objects) {
    const name = findChild(o, 'm_Name')?.value ?? '?';
    console.log(`  pathId=${o.pathId} type=${o.type} m_Name=${name}`);
  }

  const jsonIdx = args.indexOf('--json');
  if (jsonIdx !== -1 && args[jsonIdx + 1]) {
    const outPath = args[jsonIdx + 1];
    fs.writeFileSync(outPath, JSON.stringify({ root, nodes }, null, 2));
    console.log(`Wrote AST -> ${outPath}`);
  }

  if (args.includes('--tree') && objects.length > 0) {
    for (const o of objects) {
      console.log('---');
      console.log(formatTree(o).join('\n'));
    }
  }
}

// 仅当直接运行时执行 CLI
if (process.argv[1] && process.argv[1].endsWith('parse-unity-dump.mjs')) {
  main();
}