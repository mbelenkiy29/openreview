import YAML from 'yaml';
import { z } from 'zod';
import { git, pathMatches } from './util.js';

// Key names follow Greptile's greptile.json so an existing file parses unchanged; unknown keys are stripped.
export const Severity=z.enum(['low','medium','high','critical']);
export type Severity=z.infer<typeof Severity>;
export const CommentType=z.enum(['logic','syntax','style','info']);
export type CommentType=z.infer<typeof CommentType>;
const Section=z.object({included:z.boolean().default(true),collapsible:z.boolean().default(false),defaultOpen:z.boolean().default(true)});
export type Section=z.infer<typeof Section>;
const Rule=z.object({id:z.string().min(1).max(80).optional(),rule:z.string().min(3).max(1000),scope:z.preprocess(v=>typeof v==='string'?[v]:v,z.array(z.string().max(200)).max(20)).optional(),severity:Severity.optional()});
const scoped={
  strictness:z.number().int().min(1).max(3).optional(),
  commentTypes:z.array(CommentType).min(1).optional(),
  instructions:z.string().max(4000).optional(),
  rules:z.array(Rule).max(50).default([]),
  disabledRules:z.array(z.string().max(80)).max(100).default([]),
  ignorePatterns:z.string().max(4000).optional(),
};
export const ScopedConfig=z.object(scoped);
export const Config=z.object({
  mode:z.enum(['economy','balanced','deep']).default('economy'),drafts:z.boolean().default(false),
  branches:z.object({include:z.array(z.string()).default([]),exclude:z.array(z.string()).default([])}).default({include:[],exclude:[]}),
  ignore:z.array(z.string()).default([]),pathStandards:z.record(z.string(),z.string().max(2000)).default({}),
  severityThreshold:Severity.default('medium'),commentLimit:z.number().int().min(0).max(20).default(5),budgetUsd:z.number().nonnegative().max(100).default(1),
  context:z.object({maxFiles:z.number().int().min(1).max(200).default(60),maxBytesPerFile:z.number().int().min(1024).max(200000).default(60000),maxInputTokens:z.number().int().min(1000).max(100000).default(24000),maxOutputTokens:z.number().int().min(100).max(10000).default(2500),repos:z.array(z.string().max(200)).max(10).optional()}).default({maxFiles:60,maxBytesPerFile:60000,maxInputTokens:24000,maxOutputTokens:2500}),
  ...scoped,
  triggerOnUpdates:z.boolean().default(true),
  /** Verified findings the verifier rates below this (1-5) are dropped. */
  minConfidence:z.number().int().min(1).max(5).default(3),
  summarySection:Section.prefault({}),issuesTable:Section.prefault({}),confidenceScore:Section.prefault({}),sequenceDiagram:Section.prefault({collapsible:true,defaultOpen:false}),
  prDescription:z.object({enabled:z.boolean().default(false)}).prefault({}),
  /** Nested per-directory configs, filled by readTrustedConfig. */
  scopes:z.array(ScopedConfig.extend({dir:z.string()})).max(50).default([]),
  configWarnings:z.array(z.string()).default([]),
});
export type ReviewConfig=z.infer<typeof Config>;

const STRICTNESS:Record<number,Severity>={1:'low',2:'medium',3:'high'};
const DEFAULT_TYPES:CommentType[]=['logic','syntax'];
export type FileRule={id:string;rule:string;severity?:Severity};
export type FileSettings={threshold:Severity;commentTypes:CommentType[];rules:FileRule[];instructions:{scope:string;text:string}[];ignore:string[]};
type Layer=z.infer<typeof ScopedConfig>&{dir:string};
// gitignore-style: a pattern without an inner slash matches at any depth; a trailing slash means a directory.
function gitignoreGlobs(pattern:string,dir:string):string[]{let p=pattern.replace(/^\//,'');if(p.endsWith('/'))p+='**';const anchored=pattern.startsWith('/')||p.replace(/\/\*\*$/,'').includes('/');
  const prefix=dir?`${dir}/`:'';return anchored?[prefix+p]:[prefix+p,`${prefix}**/${p}`]}
const relative=(path:string,dir:string)=>dir?path.slice(dir.length+1):path;
const inside=(path:string,dir:string)=>!dir||path.startsWith(dir+'/');

/** Effective settings for one file: the root config, then each ancestor directory's config from shallow to deep. */
export function configFor(config:ReviewConfig,path:string):FileSettings{
  const standards=Object.entries(config.pathStandards).map(([pattern,rule])=>({id:`standard:${pattern}`,rule,scope:[pattern]}));
  const layers:Layer[]=[{...config,dir:'',rules:[...standards,...config.rules]},...config.scopes.filter(s=>s.dir&&inside(path,s.dir)).sort((a,b)=>a.dir.length-b.dir.length)];
  let threshold=config.strictness?STRICTNESS[config.strictness]:config.severityThreshold,commentTypes=config.commentTypes??DEFAULT_TYPES;
  let rules:FileRule[]=[];const instructions:FileSettings['instructions']=[],ignore=[...config.ignore];
  for(const layer of layers){
    if(layer.dir&&layer.strictness)threshold=STRICTNESS[layer.strictness];if(layer.dir&&layer.commentTypes)commentTypes=layer.commentTypes;
    if(layer.instructions?.trim())instructions.push({scope:layer.dir||'repository',text:layer.instructions.trim()});
    for(const p of (layer.ignorePatterns??'').split('\n').map(s=>s.trim()).filter(s=>s&&!s.startsWith('#')))ignore.push(...gitignoreGlobs(p,layer.dir));
    const disabled=new Set(layer.disabledRules);rules=rules.filter(r=>!disabled.has(r.id));
    layer.rules.forEach((r,i)=>{const id=r.id??`${layer.dir?layer.dir+':':''}rule-${i+1}`;if(disabled.has(id))return;
      if(r.scope?.length&&!r.scope.some(s=>pathMatches(relative(path,layer.dir),s)))return;rules.push({id,rule:r.rule,...(r.severity?{severity:r.severity}:{})})});
  }
  return {threshold,commentTypes,rules,instructions,ignore};
}
export function isIgnored(config:ReviewConfig,path:string){return configFor(config,path).ignore.some(p=>pathMatches(path,p))}

const ROOT_FILES=['.openreview.yml','.openreview.yaml','greptile.json'];
const parseFile=(name:string,raw:string)=>name.endsWith('.json')?JSON.parse(raw):YAML.parse(raw)??{};
export type ConfigSource={list():Promise<string[]>;read(path:string):Promise<string|undefined>};
/** Reads root and nested configs from any trusted source of base-revision files. */
export async function readTrustedConfigFrom(source:ConfigSource):Promise<ReviewConfig>{
  let root:unknown={};for(const name of ROOT_FILES){const raw=await source.read(name);if(raw===undefined)continue;root=parseFile(name,raw);break}
  const config=Config.parse({...(root as object),scopes:[],configWarnings:[]});
  let listing:string[]=[];try{listing=await source.list()}catch{return config}
  const byDir=new Map<string,string>();
  for(const path of listing){const slash=path.lastIndexOf('/'),name=path.slice(slash+1),dir=path.slice(0,Math.max(0,slash));
    if(slash<0||!ROOT_FILES.includes(name)||/(^|\/)(node_modules|vendor|dist|build)(\/|$)/.test(dir))continue;
    const current=byDir.get(dir);if(!current||ROOT_FILES.indexOf(name)<ROOT_FILES.indexOf(current.slice(current.lastIndexOf('/')+1)))byDir.set(dir,path)}
  for(const [dir,path] of [...byDir].sort((a,b)=>a[0].localeCompare(b[0])).slice(0,50)){
    try{const raw=await source.read(path);if(raw===undefined)throw new Error('missing');const parsed=ScopedConfig.safeParse(parseFile(path,raw));
      if(parsed.success)config.scopes.push({...parsed.data,dir});else config.configWarnings.push(`Ignored invalid config ${path}`)}
    catch{config.configWarnings.push(`Ignored unreadable config ${path}`)}}
  if(byDir.size>50)config.configWarnings.push(`Only the first 50 nested configs were applied`);
  return config;
}
/**
 * Reads configuration from the trusted base revision only, so a pull request cannot weaken its own review.
 * `.openreview.yml` wins over `greptile.json`; nested files in subdirectories become scoped overrides.
 */
export function readTrustedConfig(repo:string,base:string):Promise<ReviewConfig>{
  return readTrustedConfigFrom({list:async()=>(await git(repo,'ls-tree','-r','-z','--name-only',base)).split('\0').filter(Boolean),read:async path=>{try{return await git(repo,'show',`${base}:${path}`)}catch{return undefined}}});
}
