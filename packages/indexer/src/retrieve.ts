import { TEST_PATH, type CodeGraph, type FileNode } from './graph.js';
import { parseSource, type Definition } from './parse.js';

export type ChangedFile={path:string;addedLines:number[];after:string};
export type ContextKind='caller'|'callee'|'test'|'importer'|'cochange';
export type ContextItem={path:string;kind:ContextKind;reason:string;startLine:number;endLine:number;score:number;snippet:string};
export type RetrieveOptions={budgetChars?:number;maxItems?:number;coChanged?:Map<string,number>};

// Names too common to link by name alone; they still link through a resolved import.
const GENERIC=new Set(['get','set','run','init','main','new','call','apply','bind','then','map','filter','reduce','push','pop','find','has','add','delete','update','create','save','load','read','write','open','close','start','stop','handle','handler','process','render','execute','constructor','__init__','toString','equals','hashCode','String','Error','Object','Promise','Array','Map','Set','len','print','println','format','log','test','it','describe','expect','require','value','data','id','name','type','key','error']);
const MAX_SNIPPET_LINES=60;
// Java and Ruby queries capture `obj.m()` and `m()` alike, so only the other languages can tell a bare call from a member call.
const MEMBER_AWARE=new Set(['typescript','tsx','javascript','python','go','rust','csharp','php','cpp']);
/**
 * A property access (`obj.name()`) binds to a method, or to a free definition only through a direct import (`ns.name()`, `pkg.Name()`).
 * A bare call (`name()`) binds to a method only in its own file (implicit receiver), in languages that mark member calls.
 * A qualified call (`Type::name()`) binds to either.
 */
function bindable(graph:CodeGraph,from:string,ref:{member?:boolean;qualified?:boolean},c:{path:string;def:Definition;score:number}){
  if(ref.qualified)return true;
  if(ref.member)return c.def.kind==='method'||c.score>=0.95;
  return c.def.kind!=='method'||c.path===from||!MEMBER_AWARE.has(graph.files.get(from)?.language??'')}
type Candidate={path:string;kind:ContextKind;reason:string;line:number;score:number;def?:Definition};

function innermost(defs:Definition[],line:number){let best:Definition|undefined;for(const d of defs)if(d.startLine<=line&&line<=d.endLine&&(!best||d.endLine-d.startLine<best.endLine-best.startLine))best=d;return best}
/** Definitions touched by the added lines: the innermost enclosing definition of each added line, plus definitions whose header changed. */
export function changedDefinitions(defs:Definition[],addedLines:number[]):Definition[]{const out=new Set<Definition>();
  for(const line of addedLines){const d=innermost(defs,line);if(d)out.add(d);for(const h of defs)if(Math.abs(h.startLine-line)<=1)out.add(h)}
  return [...out].slice(0,16)}

function span(c:Candidate,defs:Definition[],total:number){
  if(c.def){const end=c.def.kind==='class'||c.def.kind==='interface'?Math.min(c.def.endLine,c.def.startLine+30):c.def.endLine;return {start:c.def.startLine,end:Math.min(end,c.def.startLine+MAX_SNIPPET_LINES-1)}}
  const d=innermost(defs.filter(x=>x.kind!=='class'),c.line);
  if(d&&d.endLine-d.startLine<MAX_SNIPPET_LINES)return {start:d.startLine,end:d.endLine};
  return {start:Math.max(1,c.line-12),end:Math.min(total,c.line+12)}}
const numbered=(lines:string[],start:number,end:number)=>lines.slice(start-1,end).map((t,i)=>`${String(start+i).padStart(4)}| ${t}`).join('\n');

/**
 * Selects cross-file context for a change: callers of changed definitions, definitions the changed code calls,
 * tests covering the changed files, and historically co-changed files. Items are ranked and packed into `budgetChars`.
 */
export async function retrieveContext(graph:CodeGraph,changes:ChangedFile[],options:RetrieveOptions={}):Promise<ContextItem[]>{
  const budget=options.budgetChars??24000,maxItems=options.maxItems??16,changedPaths=new Set(changes.map(c=>c.path)),candidates:Candidate[]=[];
  for(const change of changes){
    const node:FileNode|undefined=graph.files.get(change.path)??await parseSource(change.path,change.after).then(p=>p&&{...p,path:change.path,blob:'',resolved:[]});
    if(!node||!change.addedLines.length)continue;const touched=changedDefinitions(node.defs,change.addedLines);
    for(const def of touched){const generic=GENERIC.has(def.name)||def.name.length<3;
      const callers=(graph.refsByName.get(def.name)??[]).filter(r=>!changedPaths.has(r.path)).map(r=>{const binding=graph.resolve(r.path,def.name),mine=binding.find(b=>b.path===change.path),best=binding[0];
        const score=!mine||!bindable(graph,r.path,r.ref,mine)?0:mine===best||mine.score===best.score?mine.score:mine.score*0.3;return {r,score}}).filter(x=>x.score>=(generic?0.9:0.3)).sort((a,b)=>b.score-a.score).slice(0,6);
      for(const {r,score} of callers)candidates.push({path:r.path,kind:TEST_PATH.test(r.path)?'test':'caller',line:r.ref.line,score:score+(TEST_PATH.test(r.path)?0.05:0),reason:`${TEST_PATH.test(r.path)?'Test using':'Calls'} changed ${def.kind} ${def.name} (${change.path})`});}
    const ranges=touched.filter(d=>d.kind!=='class'||touched.length===1);
    const inside=node.refs.filter(r=>change.addedLines.includes(r.line)||ranges.some(d=>d.startLine<=r.line&&r.line<=d.endLine));
    const kinds=new Map<string,{name:string;member?:boolean;qualified?:boolean}>();for(const r of inside)kinds.set(`${r.name}:${r.member?'m':r.qualified?'q':''}`,r);
    for(const ref of kinds.values()){const name=ref.name;if(node.defs.some(d=>d.name===name))continue;
      // The best binding decides; when it is itself part of the change it is already in the diff, so a weaker binding elsewhere is not a substitute.
      const best=graph.resolve(change.path,name).find(c=>bindable(graph,change.path,ref,c));
      if(!best||changedPaths.has(best.path)||best.score<0.4||((GENERIC.has(name)||name.length<3)&&best.score<0.9))continue;
      candidates.push({path:best.path,kind:'callee',line:best.def.startLine,def:best.def,score:0.85*best.score,reason:`Definition of ${best.def.kind} ${name} used by changed code in ${change.path}`})}
    for(const importer of graph.importers.get(change.path)??[]){if(changedPaths.has(importer))continue;const isTest=TEST_PATH.test(importer);
      candidates.push({path:importer,kind:isTest?'test':'importer',line:1,score:isTest?0.5:0.25,reason:`${isTest?'Test importing':'Imports'} changed file ${change.path}`})}
  }
  for(const [path,count] of options.coChanged??[])if(count>=2&&!changedPaths.has(path)&&graph.files.has(path))candidates.push({path,kind:'cochange',line:1,score:Math.min(0.45,0.15+0.05*count),reason:`Changed together with this change's files in ${count} recent commits`});

  // One candidate per region: keep the best score, merge reasons.
  candidates.sort((a,b)=>b.score-a.score);const byPath=new Map<string,Candidate[]>();
  for(const c of candidates){const list=byPath.get(c.path)??[];if(c.kind==='importer'||c.kind==='cochange'){if(list.length)continue}list.push(c);byPath.set(c.path,list)}
  const sources=await graph.read([...byPath.keys()]),items:ContextItem[]=[];
  for(const [path,list] of byPath){const text=sources.get(path);if(!text)continue;const lines=text.split('\n'),defs=graph.files.get(path)?.defs??[];
    for(const c of list){let {start,end}=span(c,defs,lines.length);
      if(c.kind==='importer'||c.kind==='cochange'){const refLines=(graph.files.get(path)?.refs??[]).filter(r=>changes.some(ch=>graph.files.get(ch.path)?.defs.some(d=>d.name===r.name))).map(r=>r.line);
        start=refLines.length?Math.max(1,refLines[0]-10):1;end=Math.min(lines.length,start+29)}
      const overlap=items.find(i=>i.path===path&&start<=i.endLine&&end>=i.startLine);
      if(overlap){if(!overlap.reason.includes(c.reason))overlap.reason+=`; ${c.reason}`;overlap.startLine=Math.min(overlap.startLine,start);overlap.endLine=Math.max(overlap.endLine,end);continue}
      items.push({path,kind:c.kind,reason:c.reason,startLine:start,endLine:end,score:c.score,snippet:''})}}
  items.sort((a,b)=>b.score-a.score);const out:ContextItem[]=[];let left=budget;
  for(const item of items){if(out.length>=maxItems||left<300)break;const lines=sources.get(item.path)!.split('\n');let snippet=numbered(lines,item.startLine,item.endLine);
    if(snippet.length>left){snippet=snippet.slice(0,left).replace(/\n[^\n]*$/,'');item.endLine=item.startLine+snippet.split('\n').length-1}
    if(!snippet.trim())continue;left-=snippet.length+item.path.length+item.reason.length;out.push({...item,snippet})}
  return out;
}
