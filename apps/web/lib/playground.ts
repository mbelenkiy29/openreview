import { buildGraphFromFiles } from '@openreview/indexer';
import { configuredModel, contextFromGraph, inlinePayload, modelPrices, prepareFromSnapshots, readTrustedConfigFrom, renderSummary, review,
  type ModelAdapter, type Review, type ReviewConfig, type SourceContext } from '@openreview/engine';
import { fetchPullRequest, PlaygroundError, type PrRef } from './github';

export type Mode='context'|'review';
export type Capabilities={model:boolean;prices:boolean;auth:boolean;anonymousReview:boolean;githubToken:boolean;maxReviewUsd:number};
type Env=Record<string,string|undefined>;
export function capabilities(env:Env=process.env):Capabilities{
  const model=!!((env.ANTHROPIC_API_KEY&&(env.ANTHROPIC_MODEL||env.ANTHROPIC_MODEL_ECONOMY))||(env.OPENAI_API_KEY&&(env.OPENAI_MODEL||env.OPENAI_MODEL_ECONOMY)));
  const price=(k:string)=>Number.isFinite(Number(env[`${k}_ECONOMY`]??env[k]))&&(env[`${k}_ECONOMY`]??env[k])!==undefined&&(env[`${k}_ECONOMY`]??env[k])!=='';
  const cap=Number(env.PLAYGROUND_MAX_REVIEW_USD??0.25);
  return {model,prices:price('MODEL_INPUT_USD_PER_MILLION')&&price('MODEL_OUTPUT_USD_PER_MILLION'),auth:!!(env.AUTH_SECRET&&env.AUTH_GITHUB_ID&&env.AUTH_GITHUB_SECRET),
    anonymousReview:env.PLAYGROUND_ALLOW_ANONYMOUS_REVIEW==='true',githubToken:!!env.PLAYGROUND_GITHUB_TOKEN,maxReviewUsd:Number.isFinite(cap)&&cap>0?Math.min(cap,5):0.25}}

/** Wraps a model so a playground run makes at most `maxCalls` calls and never exceeds `capUsd`, using the worker's worst-case estimate. */
export function cappedModel(inner:ModelAdapter,prices:{input:number;output:number},capUsd:number,maxCalls=2):ModelAdapter&{spent:()=>number}{
  let spent=0,calls=0;return {spent:()=>spent,analyze:async(prompt,maxOutputTokens)=>{
    if(calls>=maxCalls)throw new Error('Model call limit reached');const estimate=(Buffer.byteLength(prompt,'utf8')*prices.input+maxOutputTokens*prices.output)/1_000_000;
    if(spent+estimate>capUsd)throw new Error(`Playground spend cap ($${capUsd.toFixed(2)}) would be exceeded`);calls++;
    const answer=await inner.analyze(prompt,maxOutputTokens);spent+=answer.usage.estimatedUsd??estimate;return answer}}}

export type PlaygroundResult={sample?:boolean;pr:{owner:string;repo:string;number:number;title:string;url:string;base:string;head:string};
  files:{path:string;status:string;additions:number;deletions:number;reviewed:boolean}[];notes:string[];
  graph:{files:number;definitions:number;references:number;importEdges:number;ms:number};context:SourceContext[];
  review?:{summaryMarkdown:string;comments:{path:string;line:number;start_line?:number;body:string}[];findings:number;rejected:number;status:string;coverage:string[];usage:Review['usage']};timings:Record<string,number>};

/** Server-side limits for a hosted run, tighter than a repository's own settings. */
function limit(config:ReviewConfig):ReviewConfig{config.context.maxFiles=Math.min(config.context.maxFiles,40);config.context.maxInputTokens=Math.min(config.context.maxInputTokens,24000);config.context.maxOutputTokens=Math.min(config.context.maxOutputTokens,3000);return config}

export async function runPlayground(ref:PrRef,mode:Mode,token:string|undefined,caps:Capabilities):Promise<PlaygroundResult>{
  const t0=Date.now(),timings:Record<string,number>={};const mark=(k:string,since:number)=>{timings[k]=Date.now()-since};
  const pr=await fetchPullRequest(ref,token);mark('fetch',t0);
  const config=limit(await readTrustedConfigFrom(pr.config));const files=prepareFromSnapshots(pr.snapshots,config);
  const t1=Date.now(),graph=await buildGraphFromFiles(pr.headFiles,{cacheDir:process.env.OPENREVIEW_INDEX_CACHE??'/tmp/openreview-index'});mark('graph',t1);
  const t2=Date.now(),context=await contextFromGraph(graph,files,config);mark('context',t2);
  let definitions=0,references=0,importEdges=0;for(const f of graph.files.values()){definitions+=f.defs.length;references+=f.refs.length;importEdges+=f.resolved.length}
  const result:PlaygroundResult={pr:{...ref,title:pr.title,url:pr.url,base:pr.base.sha,head:pr.head.sha},files:pr.files.map(f=>({...f,reviewed:files.some(x=>x.path===f.path)})),
    notes:[...pr.notes,...(files.notes??[]),...(files.omitted?[`${files.omitted} changed files omitted by the playground file limit`]:[]),'Co-change history is not available in the playground (no git history)'],
    graph:{files:graph.files.size,definitions,references,importEdges,ms:timings.graph},context,timings};
  if(mode==='review'){
    if(!caps.model||!caps.prices)throw new PlaygroundError('Full review needs a model key, model name and token prices in the Vercel environment. Context-only mode works without them.',400);
    const {input,output}=modelPrices(config.mode),model=cappedModel(configuredModel(config.mode),{input:Number(input),output:Number(output)},caps.maxReviewUsd);
    const t3=Date.now(),r=await review(files,model,config,context);mark('review',t3);
    const marker=`<!-- openreview:playground:${ref.owner}/${ref.repo}:${ref.number} -->`,{body}=renderSummary(r,config,{head:pr.head.sha,marker});
    const comments=r.findings.flatMap(f=>{const snap=files.find(x=>x.path===f.path);const c=snap&&inlinePayload(f,snap.addedLines);return c?[c]:[]});
    result.review={summaryMarkdown:body,comments,findings:r.findings.length+r.overflow.length,rejected:r.rejected.length,status:r.status,coverage:r.coverage,usage:r.usage};
  }
  timings.total=Date.now()-t0;return result;
}
