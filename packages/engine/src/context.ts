import ts from 'typescript';
import {git,safePath,type FileChange,type ReviewConfig} from './index.js';

export type SourceContext={path:string;reason:string;snippet:string};
const sourceFile=(f:FileChange)=>ts.createSourceFile(f.path,f.after,ts.ScriptTarget.Latest,true,f.path.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
export function changedSymbols(f:FileChange):string[]{if(!/\.[jt]sx?$/.test(f.path))return [];const source=sourceFile(f),names=new Set<string>();
  function visit(n:ts.Node){const line=source.getLineAndCharacterOfPosition(n.getStart(source)).line+1;
    if((ts.isFunctionDeclaration(n)||ts.isClassDeclaration(n)||ts.isInterfaceDeclaration(n)||ts.isTypeAliasDeclaration(n)||ts.isMethodDeclaration(n))&&n.name&&ts.isIdentifier(n.name)&&f.addedLines.some(x=>Math.abs(x-line)<=5))names.add(n.name.text);
    ts.forEachChild(n,visit)}visit(source);return [...names].slice(0,8)}
export async function gatherContext(repo:string,head:string,files:FileChange[],config:ReviewConfig):Promise<SourceContext[]>{const out:SourceContext[]=[],visited=new Set(files.map(f=>f.path));let budget=Math.min(config.context.maxInputTokens*2,30000);
  const candidates=new Set<string>();for(const f of files)for(const symbol of changedSymbols(f))if(symbol.length>=4)candidates.add(symbol);
  for(const symbol of [...candidates].slice(0,12)){if(budget<500)break;let matches:string[]=[];try{const text=await git(repo,'grep','-l','-F',symbol,head,'--','*.ts','*.tsx','*.js','*.jsx');matches=text.trim().split('\n').filter(Boolean).filter(x=>x.startsWith(`${head}:`)).map(x=>x.slice(head.length+1))}catch{/* no callers */}
    for(const path of matches.slice(0,4)){if(visited.has(path))continue;try{safePath(path);const raw=await git(repo,'show',`${head}:${path}`);if(raw.length>config.context.maxBytesPerFile)continue;const rows=raw.split('\n'),at=rows.findIndex(x=>x.includes(symbol));const snippet=rows.slice(Math.max(0,at-8),at+12).join('\n').slice(0,Math.min(3500,budget));if(!snippet)continue;out.push({path,reason:`Reference to changed symbol ${symbol}`,snippet});visited.add(path);budget-=snippet.length;if(out.length>=12)return out}catch{/* unreadable or binary */}}
  }return out}
