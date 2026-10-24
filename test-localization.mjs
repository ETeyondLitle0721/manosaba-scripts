import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseLocalization,loadLocalization}from './localization.mjs';
import {convertDump}from './convert-to-nani.mjs';
const [dump,locale]=process.argv.slice(2);
if(!dump||!locale)throw Error('node test-localization.mjs source.dump.txt locale.dump.txt');
const localization=loadLocalization(locale),aliases=JSON.parse(fs.readFileSync(new URL('./aliases.json',import.meta.url)));
assert.equal(Object.keys(localization).length,44);
const {files,report}=convertDump(fs.readFileSync(dump,'utf8'),{aliases,localization,strict:true,requireTranslations:true});
assert.equal(files.length,44);assert.equal(report.translation.applied,2796);assert.equal(report.translation.missing.length,0);
const adv29=files.find(f=>f.filename.endsWith('_Adv29.nani')).content;
assert.ok(adv29.includes('（我还是有点害怕在这附近走动）|#0101Adv29_Ema001|'));
assert.ok(adv29.includes('看守经常会来玄关大厅这边巡逻站岗。<br>它什么时候悄悄出现在这里都不出奇。|#0101Adv29_Narrative001|'));
const source=convertDump(fs.readFileSync(dump,'utf8'),{aliases});
assert.deepEqual(report.voiceAssociations,source.report.voiceAssociations);
for(let i=0;i<files.length;i++)assert.equal(files[i].lineCount,source.files[i].lineCount);
const partial=structuredClone(localization);delete partial['Act01_Chapter01/Act01_Chapter01_Adv29']['0101Adv29_Ema001'];

assert.throws(()=>convertDump(fs.readFileSync(dump,'utf8'),{aliases,localization:partial,requireTranslations:true}),/缺少翻译/);
const fallback=convertDump(fs.readFileSync(dump,'utf8'),{aliases,localization:partial});assert.equal(fallback.report.translation.missing.length,1);
const fixture=`ID: 1 (ClassID: 49) TextAsset
  m_Name (string) Test
  m_Script (string) ; localization document for 'Test' Naninovel scenario script
# t
; comment
甲<br>
乙
丙
`;
assert.equal(parseLocalization(fixture).Test.t,'甲<br>乙<br>丙');
assert.throws(()=>parseLocalization(fixture+'# t\n冲突\n'),/翻译冲突/);
console.log('PASS: 44 scripts / 2796 translated entries, line count and voice IDs preserved, multiline, fallback, missing/conflicting translations');
