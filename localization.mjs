import fs from 'node:fs';
import path from 'node:path';
// TextAsset.m_Script 是跨行字符串，必须按原始对象边界截取，不能用缩进 AST 解析。
export function parseLocalization(text){
 const scripts=Object.create(null);
 for(const block of text.replace(/^\uFEFF/,'').replaceAll('\r\n','\n').split(/(?=^ID: -?\d+ \(ClassID: \d+\))/m)){
  if(!/^ID: -?\d+ \(ClassID: 49\) TextAsset\s*$/m.test(block))continue;
  const m=block.match(/^  m_Script \(string\) ?/m);if(!m)continue;
  const doc=block.slice(m.index+m[0].length);
  const script=doc.match(/localization document for '([^']+)' Naninovel scenario script/)?.[1];
  if(!script)throw Error('本地化 TextAsset 缺少 script path: '+block.match(/^  m_Name \(string\) (.*)$/m)?.[1]);
  const entries=scripts[script]??=Object.create(null);let id=null,lines=[];
  function flush(){if(id===null)return;
   while(lines.length&&!lines[0].trim())lines.shift();while(lines.length&&!lines.at(-1).trim())lines.pop();
   // 空条目视为未翻译，防止空白覆盖原文。
   if(lines.length){let translated='';for(const line of lines){if(translated&&!/<br\s*\/?\s*>$/i.test(translated))translated+='<br>';translated+=line;}
    if(Object.hasOwn(entries,id)&&entries[id]!==translated)throw Error(`翻译冲突: ${script} # ${id}`);entries[id]=translated;}
  }
  for(const line of doc.split('\n')){const header=line.match(/^#\s+(.+?)\s*$/);if(header){flush();id=header[1];lines=[];}else if(id!==null&&!/^\s*;/.test(line))lines.push(line);}
  flush();
 }
 return scripts;
}
export function loadLocalization(input){
 const files=[];function walk(p){if(fs.statSync(p).isDirectory()){for(const e of fs.readdirSync(p,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)))if(e.isDirectory()||e.isFile()&&e.name.endsWith('.txt'))walk(path.join(p,e.name));}else files.push(p);}
 walk(input);const scripts=Object.create(null);
 for(const file of files){for(const [script,entries]of Object.entries(parseLocalization(fs.readFileSync(file,'utf8')))){
  const target=scripts[script]??=Object.create(null);for(const[id,text]of Object.entries(entries)){if(Object.hasOwn(target,id)&&target[id]!==text)throw Error(`翻译冲突: ${script} # ${id}`);target[id]=text;}
 }}
 if(!Object.keys(scripts).length)throw Error('未找到本地化 TextAsset；--locale 应指向 UnityDataTool 导出的 txt 或其目录');
 return scripts;
}
