'use client';
import { isValidElement, useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

// GitHub's allowlist plus the `open` attribute on <details>, so rendering matches what GitHub would show.
const schema={...defaultSchema,attributes:{...defaultSchema.attributes,details:[...(defaultSchema.attributes?.details??[]),'open']}};

function Mermaid({chart}:{chart:string}){const id=useId().replace(/[^a-zA-Z0-9]/g,''),[svg,setSvg]=useState<string>(),[error,setError]=useState<string>();
  useEffect(()=>{let live=true;import('mermaid').then(async({default:mermaid})=>{mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'dark'});
    const out=await mermaid.render(`m${id}`,chart);if(live)setSvg(out.svg)}).catch(e=>live&&setError(String(e?.message??e)));return()=>{live=false}},[chart,id]);
  if(error)return <pre className="mermaid-error">{chart}{'\n\n'}Mermaid error: {error}</pre>;
  return svg?<div className="mermaid" dangerouslySetInnerHTML={{__html:svg}}/>:<div className="muted">Rendering diagram…</div>}

function Pre({children}:{children?:ReactNode}){const child=Array.isArray(children)?children[0]:children;
  if(isValidElement(child)){const {className,children:code}=(child as ReactElement<{className?:string;children?:ReactNode}>).props,text=String(code??'').replace(/\n$/,'');
    if(className?.includes('language-mermaid'))return <Mermaid chart={text}/>;
    if(className?.includes('language-suggestion'))return <div className="suggestion"><div className="suggestion-head">Suggested change</div><pre>{text}</pre></div>}
  return <pre>{children}</pre>}

/** Renders GitHub-flavoured markdown the way a PR comment would appear, sanitized with GitHub's allowlist. */
export function Markdown({text}:{text:string}){return <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw,[rehypeSanitize,schema]]} components={{pre:Pre}}>{text}</ReactMarkdown></div>}
