import ts from 'typescript';
import {buildGraph,coChangedFiles,retrieveContext} from '@openreview/indexer';
import {git,safePath,type FileChange,type ReviewConfig} from './index.js';

export type SourceContext={path:string;reason:string;snippet:string};
export type Retriever='graph'|'grep';
const sourceFile=(f:FileChange)=>ts.createSourceFile(f.path,f.after,ts.ScriptTarget.Latest,true,f.path.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
export function changedSymbols(f:FileChange):string[]{if(!/\.[jt]sx?$/.test(f.path))return [];const source=sourceFile(f),names=new Set<string>();
  function visit(n:ts.Node){const line=source.getLineAndCharacterOfPosition(n.getStart(source)).line+1;
    if((ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n)||ts.isInterfaceDeclaration(n)||ts.isTypeAliasDeclaration(n)||ts.isMethodDeclaration(n))&&n.name&&ts.isIdentifier(n.name)&&f.addedLines.some(x=>Math.abs(x-line)<=5))names.add(n.name.text);
    ts.forEachChild(n,visit)}visit(source);return [...names].slice(0,8)}
// Context must fit inside the RELATED SOURCE section of the review prompt, which is capped at maxInputTokens characters.
const contextBudget=(config:ReviewConfig)=>Math.floor(Math.min(config.context.maxInputTokens,30000)*0.8);

/**
 * Cross-file context for the changed files at `head`. The default retriever uses the tree-sitter code graph
 * (callers, callees, tests, co-changed files); it falls back to `git grep` for symbol names if the graph fails.
 */
export async function gatherContext(repo:string,head:string,files:FileChange[],config:ReviewConfig,retriever:Retriever='graph'):Promise<SourceContext[]>{
  if(retriever==='graph')try{
    const graph=await buildGraph(repo,head,{cacheDir:process.env.OPENREVIEW_INDEX_CACHE||undefined}),coChanged=await coChangedFiles(repo,head,files.map(f=>f.path));
    const items=await retrieveContext(graph,files,{budgetChars:contextBudget(config),maxItems:16,coChanged});
    return items.map(i=>{safePath(i.path);return {path:i.path,reason:`${i.reason} [lines ${i.startLine}-${i.endLine}]`,snippet:i.snippet}});
  }catch{/* fall back to lexical search */}
  return grepContext(repo,head,files,config);
}
export async function grepContext(repo:string,head:string,files:FileChange[],config:ReviewConfig):Promise<SourceContext[]>{const out:SourceContext[]=[],visited=new Set(files.map(f=>f.path));let budget=contextBudget(config);
  const candidates=new Set<string>();for(const f of files)for(const symbol of changedSymbols(f))if(symbol.length>=4)candidates.add(symbol);
  for(const symbol of [...candidates].slice(0,12)){if(budget<500)break;let matches:string[]=[];try{const text=await git(repo,'grep','-l','-F',symbol,head,'--','*.ts','*.tsx','*.js','*.jsx');matches=text.trim().split('\n').filter(Boolean).filter(x=>x.startsWith(`${head}:`)).map(x=>x.slice(head.length+1))}catch{/* no callers */}
    for(const path of matches.slice(0,4)){if(visited.has(path))continue;try{safePath(path);const raw=await git(repo,'show',`${head}:${path}`);if(raw.length>config.context.maxBytesPerFile)continue;const rows=raw.split('\n'),at=rows.findIndex(x=>x.includes(symbol));const snippet=rows.slice(Math.max(0,at-8),at+12).join('\n').slice(0,Math.min(3500,budget));if(!snippet)continue;out.push({path,reason:`Reference to changed symbol ${symbol}`,snippet});visited.add(path);budget-=snippet.length;if(out.length>=12)return out}catch{/* unreadable or binary */}}
  }return out}
