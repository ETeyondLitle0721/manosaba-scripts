#!/usr/bin/env node
// node extract-aliases.mjs dump.cs aliases.json
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
export function extractAliases(text){
 const classes=new Map;
 for(const block of text.split(/^\/\/ Namespace: /m).slice(1)){
  if(!/^(?:Naninovel(?:\.Commands)?|WitchTrials\.Views|GigaCreation\.NaninovelExtender(?:\.\w+)*)\r?$/.test(block.split('\n')[0]))continue;
  const match=block.match(/^(?:public|internal|private|protected)(?: sealed| abstract| static| partial)* class (\w+)(?:<[^>\r\n]*>)?(?: : ([^\r\n/]+))? \/\/ TypeDefIndex:/m);
  if(!match)continue;
  const name=match[1],base=match[2]?.split(/[<,]/)[0].trim();
  const prefix=block.slice(0,match.index),alias=prefix.match(/\[CommandAlias\("((?:\\.|[^"\\])*)"\)\]/);
  const fields=block.slice(match.index+match[0].length).split('// Methods')[0].split('// Properties')[0];
  const parameters={};let attrs='';
  for(const line of fields.split(/\r?\n/)){
   if(/^\s*\[/.test(line)){attrs+=line;continue;}
   const field=line.match(/^\s*public\s+\w+Parameter\s+(\w+);/);
   if(field){const a=attrs.match(/\[ParameterAlias\("((?:\\.|[^"\\])*)"\)\]/);if(a)parameters[field[1]]=JSON.parse('"'+a[1]+'"');}
   if(line.trim()&&!line.trim().startsWith('//'))attrs='';
  }
  const ns=block.split('\n')[0].trim(),key=ns+'.'+name;
  classes.set(key,{name,ns,base,command:alias?JSON.parse('"'+alias[1]+'"'):name,parameters});
 }
 function parent(c){
  if(!c.base)return null;if(c.base==='Command')return 'Naninovel.Command';
  if(classes.has(c.ns+'.'+c.base))return c.ns+'.'+c.base;
  if(classes.has('Naninovel.Commands.'+c.base))return 'Naninovel.Commands.'+c.base;
  const matches=[...classes].filter(([k,v])=>v.name===c.base);
  if(matches.length>1)throw Error('Ambiguous base: '+c.base);
  return matches[0]?.[0];
 }
 function collect(key,seen=new Set){if(!key)return {};if(seen.has(key))throw Error('Inheritance cycle');seen.add(key);const c=classes.get(key);const inherited=collect(parent(c),seen);if(Object.values(c.parameters).includes(''))for(const k of Object.keys(inherited))if(inherited[k]==='')inherited[k]=k;return {...inherited,...c.parameters};}
 const result={};
 for(const [key,c]of classes){let cur=key;const seen=new Set;while(cur&&!seen.has(cur)){seen.add(cur);const item=classes.get(cur);if(item.base==='Command'){result[key]={command:c.command,parameters:collect(key)};break;}cur=parent(item);}}
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const [input,out='aliases.json']=process.argv.slice(2);if(!input)throw Error('node extract-aliases.mjs dump.cs aliases.json');const aliases=extractAliases(fs.readFileSync(input,'utf8'));fs.writeFileSync(out,JSON.stringify(aliases,null,2));console.log(`Extracted ${Object.keys(aliases).length} command mappings`);}
