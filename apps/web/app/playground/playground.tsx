'use client';
import { useEffect, useState } from 'react';
import type { Capabilities, PlaygroundResult } from '../../lib/playground';
import { Markdown } from './markdown';

type Caps=Capabilities&{signedIn:boolean};
const statusLabel:Record<string,string>={A:'added',M:'modified',D:'deleted'};

export function Playground(){
  const [url,setUrl]=useState(''),[mode,setMode]=useState<'context'|'review'>('context'),[caps,setCaps]=useState<Caps>();
  const [result,setResult]=useState<PlaygroundResult>(),[error,setError]=useState<string>(),[busy,setBusy]=useState(false),[elapsed,setElapsed]=useState(0),[raw,setRaw]=useState(false);
  useEffect(()=>{fetch('/api/playground').then(r=>r.json()).then(setCaps).catch(()=>{})},[]);
  useEffect(()=>{if(!busy)return;const start=Date.now(),t=setInterval(()=>setElapsed(Math.round((Date.now()-start)/1000)),500);return()=>clearInterval(t)},[busy]);
  const reviewReady=!!caps&&caps.model&&caps.prices&&(caps.signedIn||caps.anonymousReview);
  const reviewHint=!caps?'':!caps.model||!caps.prices?'Add a model key, model name and prices in Vercel to enable.':!(caps.signedIn||caps.anonymousReview)?(caps.auth?'Sign in with GitHub on the home page to enable.':'Needs GitHub sign-in or PLAYGROUND_ALLOW_ANONYMOUS_REVIEW=true.'):`Capped at $${caps.maxReviewUsd.toFixed(2)} per run.`;
  async function run(sample=false){setBusy(true);setError(undefined);setResult(undefined);setElapsed(0);
    try{const r=sample?await fetch('/api/playground?sample=1'):await fetch('/api/playground',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url,mode})});
      const data=await r.json();if(!r.ok)throw new Error(data.error??`Request failed (${r.status})`);setResult(data)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
  return <section className="content playground">
    <div className="eyebrow">PLAYGROUND</div><h1>Try the reviewer</h1>
    <p className="subtitle">Paste a GitHub pull request. OpenReview downloads the repository snapshot, builds the code graph and shows what it would send to the model, or runs the full review. Nothing is posted to GitHub.</p>
    <form className="pg-form" onSubmit={e=>{e.preventDefault();if(url.trim())void run()}}>
      <input className="pg-input" placeholder="https://github.com/owner/repo/pull/123" value={url} onChange={e=>setUrl(e.target.value)} aria-label="Pull request URL"/>
      <div className="pg-modes">
        <label className={mode==='context'?'on':''}><input type="radio" checked={mode==='context'} onChange={()=>setMode('context')}/> Context only <small>free · code graph retrieval</small></label>
        <label className={`${mode==='review'?'on':''} ${reviewReady?'':'disabled'}`}><input type="radio" disabled={!reviewReady} checked={mode==='review'} onChange={()=>setMode('review')}/> Full review <small>{reviewHint}</small></label>
      </div>
      <div className="pg-actions"><button className="primary" disabled={busy||!url.trim()}>{busy?`Working… ${elapsed}s`:'Run'}</button><button type="button" className="quiet" disabled={busy} onClick={()=>void run(true)}>Show sample output</button></div>
      {caps&&!caps.githubToken&&!caps.signedIn&&<p className="note">Tip: anonymous GitHub requests from Vercel are often rate-limited. Add a read-only <code>PLAYGROUND_GITHUB_TOKEN</code> in Vercel for reliable runs and private repos.</p>}
    </form>
    {error&&<p className="warning pg-error">{error}</p>}
    {result&&<Result result={result} raw={raw} setRaw={setRaw}/>}
  </section>;
}

function Result({result,raw,setRaw}:{result:PlaygroundResult;raw:boolean;setRaw:(v:boolean)=>void}){
  const r=result.review;return <div className="pg-result">
    {result.sample&&<p className="pg-sample">Sample — not a real review. This is a fixed example rendered by the real formatter.</p>}
    <div className="section-head"><h2>{result.pr.owner}/{result.pr.repo}#{result.pr.number} · {result.pr.title}</h2>{result.pr.url&&<a href={result.pr.url} target="_blank" rel="noreferrer">Open on GitHub ↗</a>}</div>
    {!result.sample&&<div className="stats"><div><span>Files indexed</span><strong>{result.graph.files}</strong></div><div><span>Definitions</span><strong>{result.graph.definitions}</strong></div><div><span>References</span><strong>{result.graph.references}</strong></div><div><span>Total time</span><strong>{((result.timings.total??0)/1000).toFixed(1)}s</strong></div></div>}
    {r&&<><div className="section-head"><h2>Summary comment</h2><button className="quiet" onClick={()=>setRaw(!raw)}>{raw?'Rendered':'Raw markdown'}</button></div>
      <div className="pg-card">{raw?<pre className="pg-raw">{r.summaryMarkdown}</pre>:<Markdown text={r.summaryMarkdown}/>}</div>
      <div className="section-head"><h2>Inline comments</h2><span>{r.comments.length} posted · {r.rejected} candidates rejected by validation or verification</span></div>
      {r.comments.length?r.comments.map((c,i)=><div className="pg-card" key={i}><code className="pg-loc">{c.path}:{c.start_line?`${c.start_line}-`:''}{c.line}</code>{raw?<pre className="pg-raw">{c.body}</pre>:<Markdown text={c.body}/>}</div>):<div className="empty">No inline comments.</div>}
      <p className="usage">Tokens: {r.usage.inputTokens} in · {r.usage.outputTokens} out · Estimated: {r.usage.estimatedUsd===null?'unknown':`$${r.usage.estimatedUsd.toFixed(4)}`}</p></>}
    <div className="section-head"><h2>Retrieved context</h2><span>{result.context.length} items sent to the model alongside the diff</span></div>
    {result.context.length?result.context.map((c,i)=><details className="pg-card pg-context" key={i} open={i<3}><summary><code>{c.path}</code> <span>{c.reason}</span></summary><pre>{c.snippet}</pre></details>)
      :<div className="empty">No cross-file context found (no changed definitions with callers, callees or tests in supported languages).</div>}
    <div className="section-head"><h2>Changed files</h2><span>{result.files.filter(f=>f.reviewed).length} of {result.files.length} in review scope</span></div>
    <div className="list">{result.files.map(f=><div className="row" key={f.path}><strong>{f.path}</strong><div className="row-right"><small className="muted">{statusLabel[f.status]??f.status} · +{f.additions} −{f.deletions}</small><span className={`status ${f.reviewed?'complete':''}`}>{f.reviewed?'reviewed':'skipped'}</span></div></div>)}</div>
    {!!result.notes.length&&<><div className="section-head"><h2>Coverage notes</h2></div><ul className="pg-notes">{result.notes.map((n,i)=><li key={i}>{n}</li>)}</ul></>}
  </div>;
}
