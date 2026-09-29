import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { LANGUAGES, languageFor, type LanguageId } from './languages.js';
import { parseSource, type Definition, type ParsedFile, type Reference } from './parse.js';

const exec=promisify(execFile);
const GIT=['-c','core.hooksPath=/dev/null','-c','filter.lfs.required=false','-c','filter.lfs.smudge='];
export async function git(repo:string,...args:string[]){return (await exec('git',[...GIT,'-C',repo,...args],{maxBuffer:200_000_000,timeout:60000})).stdout}

/** Reads blobs in bulk through one `git cat-file --batch` process. Never checks out or executes repository content. */
export function readBlobs(repo:string,shas:string[]):Promise<Map<string,Buffer>>{
  return new Promise((resolve,reject)=>{const out=new Map<string,Buffer>();if(!shas.length)return resolve(out);
    const child=spawn('git',[...GIT,'-C',repo,'cat-file','--batch'],{stdio:['pipe','pipe','ignore']}),chunks:Buffer[]=[];
    const timer=setTimeout(()=>child.kill('SIGKILL'),120000);
    child.stdout.on('data',(c:Buffer)=>chunks.push(c));child.on('error',reject);
    child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new Error(`git cat-file exited ${code}`));const buf=Buffer.concat(chunks);let at=0;
      while(at<buf.length){const nl=buf.indexOf(10,at);if(nl<0)break;const [sha,type,size]=buf.subarray(at,nl).toString().split(' ');at=nl+1;
        if(type==='missing'||size===undefined)continue;const n=Number(size);out.set(sha,buf.subarray(at,at+n));at+=n+1}
      resolve(out)});
    child.stdin.end(shas.join('\n')+'\n')});
}

export type FileNode=ParsedFile&{path:string;blob:string;resolved:string[]};
export type Candidate={path:string;def:Definition;score:number};
type Entry={path:string;blob:string;size:number};
const VENDORED=/(^|\/)(node_modules|vendor|third_party|dist|build|out|target|coverage|\.next|__pycache__|\.venv|venv)\//;
const GENERATED=/(\.min\.[cm]?js|\.bundle\.js|\.d\.ts|\.pb\.go|_pb2\.py|\.generated\.\w+|\.g\.cs)$/;
export const TEST_PATH=/(^|\/)(tests?|__tests__|spec|specs)\/|[._-](test|spec)\.\w+$|_test\.go$|(^|\/)test_[^/]+\.py$|Tests?\.(java|cs)$/;
const family=(l:LanguageId)=>l==='typescript'||l==='tsx'||l==='javascript'?'js':l;
const PARSER_VERSION=createHash('sha1').update(JSON.stringify(LANGUAGES)).digest('hex').slice(0,10);
const memory=new Map<string,ParsedFile>();const MEMORY_LIMIT=100_000;
function remember(key:string,value:ParsedFile){if(memory.size>=MEMORY_LIMIT)memory.delete(memory.keys().next().value!);memory.set(key,value)}

export type Resolver={paths:Set<string>;dirs:Map<string,string[]>;suffix:Map<string,string[]>;packages:Map<string,{dir:string;entry?:string}>;goModules:{dir:string;module:string}[];tsPaths:{baseUrl:string;paths:[string,string[]][]}|undefined};

export class CodeGraph{
  readonly files=new Map<string,FileNode>();readonly defsByName=new Map<string,{path:string;def:Definition}[]>();readonly refsByName=new Map<string,{path:string;ref:Reference}[]>();readonly importers=new Map<string,Set<string>>();
  /** `reader` returns file contents for paths in the indexed revision (git blobs or an in-memory snapshot). */
  constructor(nodes:FileNode[],private reader:(paths:string[])=>Promise<Map<string,string>>){
    for(const n of nodes){this.files.set(n.path,n);
      for(const def of n.defs){const list=this.defsByName.get(def.name)??[];list.push({path:n.path,def});this.defsByName.set(def.name,list)}
      for(const ref of n.refs){const list=this.refsByName.get(ref.name)??[];list.push({path:n.path,ref});this.refsByName.set(ref.name,list)}
      for(const target of n.resolved){const set=this.importers.get(target)??new Set();set.add(n.path);this.importers.set(target,set)}}
  }
  /** Ranks the definitions a reference to `name` in `from` most plausibly binds to. */
  resolve(from:string,name:string):Candidate[]{const node=this.files.get(from),defs=this.defsByName.get(name)??[];if(!node)return [];
    const imported=new Set(node.resolved),reexported=new Set(node.resolved.flatMap(p=>this.files.get(p)?.resolved??[])),dir=posix.dirname(from);
    const same=defs.filter(d=>family(this.files.get(d.path)!.language)===family(node.language));
    return same.map(({path,def})=>{let score=path===from?1:imported.has(path)?0.95:reexported.has(path)?0.75:posix.dirname(path)===dir?0.6:same.length<=2?0.45:0.15;
      // Go and Java packages share names across files in one directory without imports.
      if(score===0.6&&(node.language==='go'||node.language==='java'||node.language==='csharp'))score=0.85;return {path,def,score}}).sort((a,b)=>b.score-a.score);
  }
  read(paths:string[]):Promise<Map<string,string>>{return this.reader(paths)}
}

function stripJsonComments(text:string){return text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,m=>m.startsWith('"')?m:'').replace(/,(\s*[}\]])/g,'$1')}
function packageEntry(pkg:any):string|undefined{const e=pkg.exports;const pick=(x:any):string|undefined=>typeof x==='string'?x:x&&typeof x==='object'?pick(x['.']??x.import??x.default??x.require??x.types):undefined;return pick(e)??pkg.module??pkg.main??pkg.types}

export function buildResolver(paths:string[],configs:Map<string,string>):Resolver{
  const set=new Set(paths),dirs=new Map<string,string[]>(),suffix=new Map<string,string[]>();
  for(const p of paths){const d=posix.dirname(p);(dirs.get(d)??dirs.set(d,[]).get(d)!).push(p);const key=p.split('/').slice(-2).join('/');(suffix.get(key)??suffix.set(key,[]).get(key)!).push(p)}
  const packages=new Map<string,{dir:string;entry?:string}>(),goModules:Resolver['goModules']=[];let tsPaths:Resolver['tsPaths'];
  for(const [path,text] of configs){try{
    if(path.endsWith('package.json')){const pkg=JSON.parse(text);if(typeof pkg.name==='string')packages.set(pkg.name,{dir:posix.dirname(path),entry:packageEntry(pkg)})}
    else if(path.endsWith('go.mod')){const m=/^module\s+(\S+)/m.exec(text);if(m)goModules.push({dir:posix.dirname(path),module:m[1]})}
    else if(/tsconfig(\.base)?\.json$/.test(path)&&!path.includes('/')){const opts=JSON.parse(stripJsonComments(text)).compilerOptions??{};if(opts.paths||opts.baseUrl){const base=posix.normalize(opts.baseUrl??'.');tsPaths={baseUrl:base==='.'?'':base,paths:Object.entries(opts.paths??{}) as [string,string[]][]}}}
  }catch{/* malformed config is ignored */}}
  goModules.sort((a,b)=>b.module.length-a.module.length);
  return {paths:set,dirs,suffix,packages,goModules,tsPaths};
}
const JS_EXT=['.ts','.tsx','.d.ts','.js','.jsx','.mjs','.cjs','.mts','.cts'];
function jsCandidates(base:string){const b=posix.normalize(base).replace(/^\.\//,''),stem=b.replace(/\.[cm]?jsx?$/,'');return [b,...JS_EXT.map(e=>stem+e),...JS_EXT.map(e=>`${b}/index${e}`)]}
function bySuffix(r:Resolver,tail:string):string[]{const key=tail.split('/').slice(-2).join('/');return (r.suffix.get(key)??[]).filter(p=>p===tail||p.endsWith('/'+tail))}
const first=(r:Resolver,c:string[])=>{const hit=c.find(p=>r.paths.has(p));return hit?[hit]:[]};

/** Maps an import specifier to repository files. Unresolvable (external) imports return []. */
export function resolveImport(r:Resolver,from:string,spec:string,language:LanguageId):string[]{
  const dir=posix.dirname(from);
  switch(family(language)){
    case 'js':{if(spec.startsWith('.'))return first(r,jsCandidates(posix.join(dir,spec)));
      if(r.tsPaths)for(const [pattern,targets] of r.tsPaths.paths){const star=pattern.indexOf('*'),prefix=star<0?pattern:pattern.slice(0,star),suffix=star<0?'':pattern.slice(star+1);
        if(star<0?spec!==pattern:!(spec.startsWith(prefix)&&spec.endsWith(suffix)))continue;const mid=star<0?'':spec.slice(prefix.length,spec.length-suffix.length);
        for(const t of targets){const hit=first(r,jsCandidates(posix.join(r.tsPaths.baseUrl,t.replace('*',mid))));if(hit.length)return hit}}
      let best:{name:string;dir:string;entry?:string}|undefined;for(const [name,p] of r.packages)if((spec===name||spec.startsWith(name+'/'))&&(!best||name.length>best.name.length))best={name,...p};
      if(best){const sub=spec.slice(best.name.length+1),root=best.dir==='.'?'':best.dir;
        if(sub)return first(r,[...jsCandidates(posix.join(root,sub)),...jsCandidates(posix.join(root,'src',sub))]);
        return first(r,[...(best.entry?jsCandidates(posix.join(root,best.entry)):[]),...jsCandidates(posix.join(root,'src/index')),...jsCandidates(posix.join(root,'index'))])}
      return r.tsPaths?first(r,jsCandidates(posix.join(r.tsPaths.baseUrl,spec))):[]}
    case 'python':{const dots=/^\.*/.exec(spec)![0].length,mod=spec.slice(dots).replace(/\./g,'/');
      if(dots){let base=dir;for(let i=1;i<dots;i++)base=posix.dirname(base);const p=posix.join(base,mod);return first(r,mod?[`${p}.py`,`${p}/__init__.py`]:[`${base}/__init__.py`])}
      const direct=first(r,[`${mod}.py`,`${mod}/__init__.py`,`src/${mod}.py`,`src/${mod}/__init__.py`]);if(direct.length)return direct;
      const hits=[...bySuffix(r,`${mod}.py`),...bySuffix(r,`${mod}/__init__.py`)];return hits.length===1?hits:[]}
    case 'go':{const m=r.goModules.find(g=>spec===g.module||spec.startsWith(g.module+'/'));if(!m)return [];const target=posix.normalize(posix.join(m.dir,spec.slice(m.module.length+1)||'.'));
      return (r.dirs.get(target==='.'?'.':target)??[]).filter(p=>p.endsWith('.go')&&!p.endsWith('_test.go'))}
    case 'java':{const path=spec.replace(/\./g,'/');const hits=bySuffix(r,`${path}.java`);if(hits.length)return hits.slice(0,1);
      const pkgDir=[...r.dirs.keys()].find(d=>d===path||d.endsWith('/'+path));return pkgDir?(r.dirs.get(pkgDir)??[]).filter(p=>p.endsWith('.java')):[]}
    case 'rust':{if(!spec.includes('::')&&/^\w+$/.test(spec)){const stem=/(^|\/)(mod|lib|main)\.rs$/.test(from)?dir:posix.join(dir,posix.basename(from,'.rs'));return first(r,[`${posix.join(stem,spec)}.rs`,`${posix.join(stem,spec)}/mod.rs`])}
      const parts=spec.replace(/\{[\s\S]*$/,'').split('::').filter(Boolean);let base:string;
      if(parts[0]==='crate'){const i=from.lastIndexOf('src/');base=i>=0?from.slice(0,i+3):'src';parts.shift()}else if(parts[0]==='super'||parts[0]==='self'){base=parts[0]==='super'?posix.dirname(dir):dir;parts.shift()}else return [];
      for(let n=parts.length;n>0;n--){const p=posix.join(base,...parts.slice(0,n));const hit=first(r,[`${p}.rs`,`${p}/mod.rs`]);if(hit.length)return hit}return []}
    case 'ruby':{const rel=first(r,[posix.join(dir,spec.endsWith('.rb')?spec:`${spec}.rb`)]);if(rel.length)return rel;return first(r,[`lib/${spec}.rb`,`${spec}.rb`,`app/${spec}.rb`])}
    case 'php':{const parts=spec.split('\\').filter(Boolean);const hits=bySuffix(r,parts.slice(-2).join('/')+'.php');return hits.slice(0,1)}
    case 'cpp':{const rel=first(r,[posix.join(dir,spec)]);if(rel.length)return rel;const hits=bySuffix(r,spec);return hits.length<=2?hits:[]}
    default:return [];
  }
}

export type BuildOptions={maxFiles?:number;maxBytes?:number;cacheDir?:string};
async function cached(cacheDir:string|undefined,blob:string):Promise<ParsedFile|undefined>{const key=`${PARSER_VERSION}:${blob}`,hit=memory.get(key);if(hit)return hit;if(!cacheDir)return undefined;
  try{const value=JSON.parse(await readFile(join(cacheDir,PARSER_VERSION,blob.slice(0,2),`${blob}.json`),'utf8')) as ParsedFile;remember(key,value);return value}catch{return undefined}}
async function store(cacheDir:string|undefined,blob:string,value:ParsedFile){remember(`${PARSER_VERSION}:${blob}`,value);if(!cacheDir)return;
  try{const file=join(cacheDir,PARSER_VERSION,blob.slice(0,2),`${blob}.json`);await mkdir(dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.tmp`;await writeFile(tmp,JSON.stringify(value));await rename(tmp,file)}catch{/* cache is best effort */}}

/**
 * Builds a symbol/reference/import graph for `rev`. Parsed files are cached by blob sha, so repeat builds only parse changed blobs.
 * Pass `cacheDir` to persist the cache across processes.
 */
type Source={entries:Entry[];load:(blobs:string[])=>Promise<Map<string,Buffer>>};
async function assemble(source:Source,options:BuildOptions):Promise<FileNode[]>{
  const maxFiles=options.maxFiles??25000,maxBytes=options.maxBytes??400_000,{entries}=source;
  const allPaths=entries.map(e=>e.path),blobs=new Map(entries.map(e=>[e.path,e.blob]));
  const sources=entries.filter(e=>languageFor(e.path)&&e.size<=maxBytes&&!VENDORED.test(e.path)&&!GENERATED.test(e.path)).slice(0,maxFiles);
  const configs=entries.filter(e=>isGraphConfig(e.path)&&e.size<=200_000);
  const parsed=new Map<string,ParsedFile>(),missing:Entry[]=[];
  for(const e of sources){const hit=await cached(options.cacheDir,e.blob);if(hit)parsed.set(e.path,hit);else missing.push(e)}
  const configText=new Map<string,string>();
  const pending=[...missing,...configs],isConfig=new Set(configs);
  for(let i=0;i<pending.length;i+=200){const batch=pending.slice(i,i+200),content=await source.load(batch.map(e=>e.blob));
    for(const e of batch){const buf=content.get(e.blob);if(!buf)continue;if(isConfig.has(e)){configText.set(e.path,buf.toString('utf8'));continue}
      if(buf.subarray(0,8000).includes(0))continue;try{const value=await parseSource(e.path,buf.toString('utf8'));if(value){parsed.set(e.path,value);await store(options.cacheDir,e.blob,value)}}catch{/* unparseable file is skipped */}}}
  const resolver=buildResolver(allPaths,configText);
  return [...parsed].map(([path,p])=>({...p,path,blob:blobs.get(path)!,resolved:[...new Set(p.imports.flatMap(s=>resolveImport(resolver,path,s,p.language)))].filter(x=>x!==path)}));
}
/** Package manifests and tsconfig files the import resolver reads. */
export const isGraphConfig=(path:string)=>!VENDORED.test(path)&&(/(^|\/)(package\.json|go\.mod)$/.test(path)||/^tsconfig(\.base)?\.json$/.test(path));
/** Git's blob id for `content`, so snapshots share the parse cache with git-backed builds. */
export const blobSha=(content:Buffer)=>createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');

/**
 * Builds a symbol/reference/import graph for `rev`. Parsed files are cached by blob sha, so repeat builds only parse changed blobs.
 * Pass `cacheDir` to persist the cache across processes.
 */
export async function buildGraph(repo:string,rev:string,options:BuildOptions={}):Promise<CodeGraph>{
  const raw=await git(repo,'ls-tree','-r','-z','--long',rev),entries:Entry[]=[];
  for(const line of raw.split('\0')){const tab=line.indexOf('\t');if(tab<0)continue;const [,type,blob,size]=line.slice(0,tab).trim().split(/\s+/),path=line.slice(tab+1);
    if(type!=='blob'||path.split('/').some(p=>p==='..'||p==='.git'))continue;entries.push({path,blob,size:Number(size)})}
  const nodes=await assemble({entries,load:blobs=>readBlobs(repo,blobs)},options),byPath=new Map(entries.map(e=>[e.path,e.blob]));
  return new CodeGraph(nodes,async paths=>{const want=paths.map(p=>[p,byPath.get(p)] as const).filter((x):x is readonly [string,string]=>!!x[1]);
    const blobs=await readBlobs(repo,[...new Set(want.map(x=>x[1]))]);return new Map(want.map(([p,b])=>[p,blobs.get(b)?.toString('utf8')??'']))});
}
/** Builds the same graph from an in-memory snapshot (path → content), for environments without git. */
export async function buildGraphFromFiles(files:Map<string,Buffer|string>,options:BuildOptions={}):Promise<CodeGraph>{
  const byBlob=new Map<string,Buffer>(),entries:Entry[]=[];
  for(const [path,value] of files){if(path.split('/').some(p=>p==='..'||p==='.git'||!p))continue;const buf=typeof value==='string'?Buffer.from(value):value,blob=blobSha(buf);byBlob.set(blob,buf);entries.push({path,blob,size:buf.length})}
  const nodes=await assemble({entries,load:async blobs=>new Map(blobs.flatMap(b=>byBlob.has(b)?[[b,byBlob.get(b)!] as const]:[]))},options);
  return new CodeGraph(nodes,async paths=>new Map(paths.flatMap(p=>files.has(p)?[[p,String(files.get(p))] as const]:[])));
}

/** Files that historically change together with `paths` (from the last `limit` commits), as path→count. */
export async function coChangedFiles(repo:string,rev:string,paths:string[],limit=200):Promise<Map<string,number>>{
  const out=new Map<string,number>(),targets=new Set(paths);let log='';try{log=await git(repo,'log',`-n${limit}`,'--no-merges','--name-only','--format=%x00',rev)}catch{return out}
  for(const commit of log.split('\0')){const files=commit.split('\n').map(s=>s.trim()).filter(Boolean);if(files.length>40||!files.some(f=>targets.has(f)))continue;
    for(const f of files)if(!targets.has(f))out.set(f,(out.get(f)??0)+1)}
  return out;
}
