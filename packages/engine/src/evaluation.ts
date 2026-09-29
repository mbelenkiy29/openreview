import {performance} from 'node:perf_hooks';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {Config,git,prepareLocal,review,safePath,type FileChange,type ModelAdapter,type ReviewConfig} from './index.js';
import {gatherContext,type Retriever} from './context.js';
export type Case={id:string;split:'development'|'heldout';category:string;files:FileChange[];expected:{path:string;line:number}[]};
export type CaseScore={id:string;split:string;category:string;truePositive:number;falsePositive:number;missed:number;cleanFalsePositive:boolean;latencyMs:number;estimatedUsd:number|null;status:string};
/** A case backed by a real two-commit repository, so retrieval runs against actual history. `expected[].contains` may list alternative lines. */
export type RepoCase={id:string;split:'development'|'heldout';language:string;category:string;base:Record<string,string>;head:Record<string,string|null>;expected:{path:string;contains:string|string[]}[];context:string[];decoys?:string[]};

function summarize(results:CaseScore[]){const tp=results.reduce((n,x)=>n+x.truePositive,0),fp=results.reduce((n,x)=>n+x.falsePositive,0),fn=results.reduce((n,x)=>n+x.missed,0),priced=results.every(x=>x.estimatedUsd!==null),cost=priced?results.reduce((n,x)=>n+(x.estimatedUsd??0),0):null;
  return {precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,cleanFalsePositives:results.filter(x=>x.cleanFalsePositive).length,latencyMs:results.reduce((n,x)=>n+x.latencyMs,0),estimatedUsd:cost,costPerCorrectFinding:cost!==null&&tp?cost/tp:null}}
// Each expected entry is satisfied by a finding on any of its acceptable lines; findings on no acceptable line are false positives.
function score(expected:{path:string;lines:number[]}[],findings:{path:string;line:number}[]){const hit=new Set<number>();let falsePositive=0;
  for(const f of findings){const i=expected.findIndex(e=>e.path===f.path&&e.lines.includes(f.line));if(i<0)falsePositive++;else hit.add(i)}
  return {truePositive:hit.size,falsePositive,missed:expected.length-hit.size}}

export async function evaluate(cases:Case[],model:ModelAdapter,config:ReviewConfig=Config.parse({})){const results:CaseScore[]=[];
  for(const c of cases){const start=performance.now(),r=await review(c.files,model,config);const s=score(c.expected.map(e=>({path:e.path,lines:[e.line]})),r.findings);
    results.push({id:c.id,split:c.split,category:c.category,...s,cleanFalsePositive:!c.expected.length&&r.findings.length>0,latencyMs:Math.round(performance.now()-start),estimatedUsd:r.usage.estimatedUsd,status:r.status});
  }
  return {labelStatus:'seeded fixtures; human labels pending',cases:results,summary:summarize(results)};
}

/** Writes the case as a git repo with a base and a head commit. Call `cleanup` when done. */
export async function materialize(c:RepoCase){const dir=await mkdtemp(join(tmpdir(),'openreview-case-'));
  const put=async(files:Record<string,string|null>)=>{for(const [p,text] of Object.entries(files)){safePath(p);const file=join(dir,p);if(text===null){await rm(file,{force:true});continue}await mkdir(dirname(file),{recursive:true});await writeFile(file,text)}};
  try{await git(dir,'init','-q');await git(dir,'config','user.email','eval@example.test');await git(dir,'config','user.name','Eval');
    await put(c.base);await git(dir,'add','-A');await git(dir,'commit','-qm','base');const base=(await git(dir,'rev-parse','HEAD')).trim();
    await put(c.head);await git(dir,'add','-A');await git(dir,'commit','-qm','head');const head=(await git(dir,'rev-parse','HEAD')).trim();
    return {dir,base,head,cleanup:()=>rm(dir,{recursive:true,force:true})}}catch(e){await rm(dir,{recursive:true,force:true});throw e}}
/** Resolves `contains` markers to added line numbers in the head revision. Throws when a marker does not match an added line. */
export function expectedLines(c:RepoCase,files:FileChange[]){return c.expected.map(e=>{const f=files.find(x=>x.path===e.path);if(!f)throw new Error(`${c.id}: ${e.path} is not in the diff`);
  const needles=Array.isArray(e.contains)?e.contains:[e.contains],rows=f.after.split('\n'),lines=f.addedLines.filter(n=>needles.some(s=>rows[n-1]?.includes(s)));
  if(!lines.length)throw new Error(`${c.id}: no added line in ${e.path} contains ${JSON.stringify(e.contains)}`);return {path:e.path,lines}})}

export type RetrievalScore={id:string;language:string;category:string;retriever:Retriever;recall:number;found:string[];missing:string[];decoyHits:string[];items:number;chars:number;latencyMs:number};
/** Measures whether each retriever surfaces the files needed to prove the case, and whether it pulls in same-named decoys. No model calls. */
export async function evaluateRetrieval(cases:RepoCase[],retrievers:Retriever[]=['grep','graph'],config:ReviewConfig=Config.parse({})){const rows:RetrievalScore[]=[];
  for(const c of cases){const m=await materialize(c);try{const files=await prepareLocal(m.dir,m.base,m.head,config);
    for(const retriever of retrievers){const start=performance.now(),context=await gatherContext(m.dir,m.head,files,config,retriever),paths=new Set(context.map(x=>x.path));
      const found=c.context.filter(p=>paths.has(p));rows.push({id:c.id,language:c.language,category:c.category,retriever,recall:c.context.length?found.length/c.context.length:1,found,missing:c.context.filter(p=>!paths.has(p)),decoyHits:(c.decoys??[]).filter(p=>paths.has(p)),items:context.length,chars:context.reduce((n,x)=>n+x.snippet.length,0),latencyMs:Math.round(performance.now()-start)})}
  }finally{await m.cleanup()}}
  const summary=Object.fromEntries(retrievers.map(r=>{const mine=rows.filter(x=>x.retriever===r),decoyCases=cases.filter(c=>c.decoys?.length).length;
    const byLanguage=Object.fromEntries([...new Set(mine.map(x=>x.language))].map(l=>{const s=mine.filter(x=>x.language===l);return [l,s.reduce((n,x)=>n+x.recall,0)/s.length]}));
    return [r,{meanRecall:mine.reduce((n,x)=>n+x.recall,0)/Math.max(1,mine.length),fullRecallCases:mine.filter(x=>x.recall===1).length,cases:mine.length,decoyHits:mine.reduce((n,x)=>n+x.decoyHits.length,0),casesWithDecoys:decoyCases,meanChars:Math.round(mine.reduce((n,x)=>n+x.chars,0)/Math.max(1,mine.length)),recallByLanguage:byLanguage}]}));
  return {labelStatus:'seeded fixtures; human labels pending',summary,cases:rows};
}

/** Full review over repository cases: diff preparation, retrieval and the two-pass model review, scored against expected lines. */
export async function evaluateRepo(cases:RepoCase[],model:ModelAdapter,config:ReviewConfig=Config.parse({}),retriever:Retriever='graph'){const results:(CaseScore&{language:string})[]=[];
  for(const c of cases){const m=await materialize(c);try{const start=performance.now(),files=await prepareLocal(m.dir,m.base,m.head,config),expected=expectedLines(c,files);
    const context=await gatherContext(m.dir,m.head,files,config,retriever),r=await review(files,model,config,context);
    results.push({id:c.id,split:c.split,category:c.category,language:c.language,...score(expected,r.findings),cleanFalsePositive:!expected.length&&r.findings.length>0,latencyMs:Math.round(performance.now()-start),estimatedUsd:r.usage.estimatedUsd,status:r.status});
  }finally{await m.cleanup()}}
  const splits=Object.fromEntries(['development','heldout'].map(s=>[s,summarize(results.filter(x=>x.split===s))]));
  return {labelStatus:'seeded fixtures; human labels pending',retriever,cases:results,summary:summarize(results),splits};
}
