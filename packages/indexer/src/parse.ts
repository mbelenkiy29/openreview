import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LANGUAGES, languageFor, type LanguageId, type LanguageSpec } from './languages.js';

// The runtime is UMD/CommonJS and ships its grammars as .wasm files next to it. It is loaded lazily through
// Node's own module loader (hidden from bundlers, which would otherwise rewrite require/resolve), trying:
// TREE_SITTER_WASM_DIR, this module's location, then the working directory (e.g. a Next.js app on Vercel).
type TreeSitter=typeof import('@vscode/tree-sitter-wasm');
const PACKAGE='@vscode/tree-sitter-wasm';
let runtime:{TS:TreeSitter;wasmDir:string}|undefined;
function treeSitter(){if(runtime)return runtime;const {createRequire}=process.getBuiltinModule('node:module') as typeof import('node:module');
  const {existsSync}=process.getBuiltinModule('node:fs') as typeof import('node:fs'),cwd=process.cwd(),dirs:string[]=[];
  if(process.env.TREE_SITTER_WASM_DIR)dirs.push(process.env.TREE_SITTER_WASM_DIR);
  for(const base of [import.meta.url,pathToFileURL(join(cwd,'package.json')).href]){try{dirs.push(dirname(createRequire(base).resolve(PACKAGE)))}catch{/* try the next location */}}
  dirs.push(...[cwd,join(cwd,'apps/web')].map(d=>join(d,'node_modules',PACKAGE,'wasm')));
  const dir=dirs.find(d=>existsSync(join(d,'tree-sitter.js'))&&existsSync(join(d,'tree-sitter.wasm')));
  if(!dir)throw new Error(`Cannot find ${PACKAGE} (looked in ${dirs.join(', ')}); set TREE_SITTER_WASM_DIR`);
  return runtime={TS:createRequire(pathToFileURL(join(dir,'tree-sitter.js')).href)(join(dir,'tree-sitter.js')) as TreeSitter,wasmDir:dir}}

export type DefKind='function'|'method'|'class'|'interface'|'type'|'enum'|'variable';
export type Definition={name:string;kind:DefKind;startLine:number;endLine:number};
/**
 * `member` marks a property access (`obj.name()`, `pkg.Name()`): it binds to free definitions only through a direct import.
 * `qualified` marks a path-qualified call (`Type::name()`, `ns::name()`), which may bind to methods and free definitions alike.
 */
export type Reference={name:string;line:number;member?:boolean;qualified?:boolean};
export type ParsedFile={language:LanguageId;defs:Definition[];refs:Reference[];imports:string[]};

type Loaded={parser:InstanceType<TreeSitter['Parser']>;defs:InstanceType<TreeSitter['Query']>;refs:InstanceType<TreeSitter['Query']>;imports:InstanceType<TreeSitter['Query']>};
let ready:Promise<void>|undefined;
const loaded=new Map<LanguageId,Promise<Loaded>>();

async function load(spec:LanguageSpec):Promise<Loaded>{const {TS,wasmDir}=treeSitter();
  ready??=TS.Parser.init({locateFile:(file:string)=>join(wasmDir,file)});await ready;
  const language=await TS.Language.load(join(wasmDir,spec.wasm)),parser=new TS.Parser();parser.setLanguage(language);
  return {parser,defs:new TS.Query(language,spec.defs),refs:new TS.Query(language,spec.refs),imports:new TS.Query(language,spec.imports)};
}
function loader(spec:LanguageSpec){let p=loaded.get(spec.id);if(!p){p=load(spec);loaded.set(spec.id,p)}return p}
export async function warmLanguages(ids:LanguageId[]=LANGUAGES.map(l=>l.id)){await Promise.all(LANGUAGES.filter(l=>ids.includes(l.id)).map(loader))}

const unquote=(s:string)=>s.replace(/^["'<`]|["'>`]$/g,'');
// Parses one file into definitions, references and import specifiers. Returns undefined for unsupported files.
export async function parseSource(path:string,source:string):Promise<ParsedFile|undefined>{
  const spec=languageFor(path);if(!spec)return undefined;const l=await loader(spec);const tree=l.parser.parse(source);if(!tree)return undefined;
  try{
    const root=tree.rootNode,defs:Definition[]=[],seen=new Set<string>();
    for(const m of l.defs.matches(root)){const def=m.captures.find(c=>c.name.startsWith('def.')),name=m.captures.find(c=>c.name==='name');if(!def||!name)continue;
      let kind=def.name.slice(4) as DefKind;const node=def.node;
      if(kind==='variable'){const value=node.childForFieldName('value');if(value&&/function|arrow/.test(value.type))kind='function'}
      if(kind==='function'&&spec.id==='python'&&node.parent?.parent?.type==='class_definition')kind='method';
      const key=`${name.node.text}:${node.startPosition.row}`;if(seen.has(key))continue;seen.add(key);
      defs.push({name:name.node.text.replace(/^.*::/,''),kind,startLine:node.startPosition.row+1,endLine:node.endPosition.row+1})}
    const defLines=new Set(defs.map(d=>`${d.name}:${d.startLine}`)),refs:Reference[]=[];
    const refSeen=new Set<string>();
    for(const c of l.refs.captures(root)){if(!/^ref(\.member|\.qualified)?$/.test(c.name))continue;const name=c.node.text,line=c.node.startPosition.row+1,key=`${name}:${line}`,seen=`${key}:${c.name}`;
      if(defLines.has(key)||refSeen.has(seen))continue;refSeen.add(seen);refs.push(c.name==='ref.member'?{name,line,member:true}:c.name==='ref.qualified'?{name,line,qualified:true}:{name,line})}
    const imports=[...new Set(l.imports.captures(root).filter(c=>c.name==='source').map(c=>unquote(c.node.text)))];
    return {language:spec.id,defs,refs,imports};
  }finally{tree.delete()}
}
