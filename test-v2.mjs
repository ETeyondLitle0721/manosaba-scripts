import assert from 'node:assert/strict';
import fs from 'node:fs';
import{convertDump}from './convert-to-nani.mjs';
import{extractAliases}from './extract-aliases.mjs';
import{parseDump,findObjects,getCommandRids,indexManagedReferences,findChild as c}from './parse-unity-dump.mjs';
const [cs,...inputs]=process.argv.slice(2);if(!cs||!inputs.length)throw Error('node test-v2.mjs dump.cs dump1.txt [dump2.txt]');
const aliases=extractAliases(fs.readFileSync(cs,'utf8'));
assert.equal(aliases['WitchTrials.Views.PrintTextModified'].command,'print');
assert.equal(aliases['WitchTrials.Views.PrintTextModified'].parameters.Text,'');
assert.equal(aliases['WitchTrials.Views.PrintTextModified'].parameters.ConditionalExpression,'if');
assert.equal(aliases['GigaCreation.NaninovelExtender.ExtendedActors.ModifyCharacterExtended'].parameters.IdAndAppearance,'');
assert.equal(aliases['WitchTrials.Views.ChoiceMapArea'].parameters.CategoryNames,'CategoryNames');
for(const file of inputs){
 const text=fs.readFileSync(file,'utf8'),{files,report}=convertDump(text,{aliases,strict:true});
 const objects=findObjects(parseDump(text).nodes).filter(o=>getCommandRids(o).length);
 assert.equal(objects.reduce((n,o)=>n+getCommandRids(o).length,0),Object.values(report.commandCounts).reduce((a,b)=>a+b,0));
 for(const o of objects)for(const r of indexManagedReferences(o).values()){
  const t=c(r,'type'),cls=c(t,'class')?.value,ns=c(t,'ns')?.value;
  if(cls.endsWith('ScriptLine'))continue;
  assert.ok(aliases[ns+'.'+cls],`Missing alias metadata: ${ns}.${cls}`);
 }
 for(const v of report.voiceAssociations){const f=files.find(f=>f.filename===v.script+'.nani');for(const id of v.textIds)assert.ok(f.content.split('\n')[v.lineIndex].includes(`|#${id}|`));}
 assert.equal(report.issues.length,0);
 console.log(JSON.stringify({input:file,scripts:files.length,commands:Object.values(report.commandCounts).reduce((a,b)=>a+b,0),prints:report.voiceAssociations.length,textIds:report.voiceAssociations.reduce((n,v)=>n+v.textIds.length,0),issues:report.issues.length}));
}
console.log('PASS: alias inheritance including generic bases, full command coverage, text IDs on original lines');
