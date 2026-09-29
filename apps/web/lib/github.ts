import { Readable } from 'node:stream';
import { isGraphConfig, languageFor, readTarGz } from '@openreview/indexer';
import type { ConfigSource, Snapshot } from '@openreview/engine';

export type PrRef={owner:string;repo:string;number:number};
export type PullRequest={ref:PrRef;title:string;url:string;base:{sha:string;ref:string};head:{sha:string;ref:string};
  files:{path:string;status:Snapshot['status'];additions:number;deletions:number}[];snapshots:Snapshot[];headFiles:Map<string,Buffer>;config:ConfigSource;notes:string[]};
type Fetch=typeof fetch;

const NAME=/^[A-Za-z0-9_.-]{1,100}$/;
/** Accepts github.com/owner/repo/pull/123 (with or without scheme, trailing /files etc.) or owner/repo#123. */
export function parsePrUrl(input:string):PrRef{const text=input.trim();
  const m=/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(text)??/^([^/\s#]+)\/([^/\s#]+)#(\d+)$/.exec(text);
  if(!m||![m[1],m[2]].every(n=>NAME.test(n)&&n!=='.'&&n!=='..'))throw new PlaygroundError('Enter a GitHub pull request URL like https://github.com/owner/repo/pull/123',400);
  return {owner:m[1],repo:m[2].replace(/\.git$/,''),number:Number(m[3])}}

export class PlaygroundError extends Error{constructor(message:string,readonly status=400){super(message)}}
const MAX_SOURCE_BYTES=400_000,MAX_CHANGED_FILES=300;
const statusOf=(s:string):Snapshot['status']=>s==='added'?'A':s==='removed'?'D':'M';
const encodePath=(p:string)=>p.split('/').map(encodeURIComponent).join('/');

/**
 * Fetches everything the engine needs for one PR without git: metadata and patches from the REST API,
 * base-revision files from raw.githubusercontent.com, and a head snapshot from the repository tarball.
 */
export async function fetchPullRequest(ref:PrRef,token?:string,http:Fetch=fetch):Promise<PullRequest>{
  const headers:Record<string,string>={accept:'application/vnd.github+json','x-github-api-version':'2022-11-28','user-agent':'openreview-playground',...(token?{authorization:`Bearer ${token}`}:{})};
  const repoPath=`${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  async function api(path:string){const r=await http(`https://api.github.com/repos/${repoPath}${path}`,{headers,cache:'no-store'});
    if(r.status===404)throw new PlaygroundError(token?'Pull request not found, or the token cannot read this repository.':'Pull request not found. Private repositories need sign-in or PLAYGROUND_GITHUB_TOKEN.',404);
    if(r.status===403||r.status===429){const remaining=r.headers.get('x-ratelimit-remaining');throw new PlaygroundError(remaining==='0'&&!token?'GitHub rate limit reached for anonymous requests. Add PLAYGROUND_GITHUB_TOKEN in Vercel (a read-only token) or sign in.':'GitHub refused the request (rate limit or permissions).',429)}
    if(!r.ok)throw new PlaygroundError(`GitHub API error ${r.status}`,502);return r.json() as Promise<any>}
  const pr=await api(`/pulls/${ref.number}`);const base={sha:String(pr.base.sha),ref:String(pr.base.ref)},head={sha:String(pr.head.sha),ref:String(pr.head.ref)};
  // PR patches are computed against the merge base, so "before" contents come from there; config comes from the base tip.
  let mergeBase=base.sha;try{mergeBase=String((await api(`/compare/${base.sha}...${head.sha}?per_page=1`)).merge_base_commit?.sha??base.sha)}catch(e){if(e instanceof PlaygroundError&&e.status===429)throw e}
  const listed:any[]=[];for(let page=1;page<=3;page++){const rows=await api(`/pulls/${ref.number}/files?per_page=100&page=${page}`) as any[];listed.push(...rows);if(rows.length<100)break}
  const notes:string[]=[];if(listed.length>=MAX_CHANGED_FILES||Number(pr.changed_files)>listed.length)notes.push(`Only the first ${listed.length} of ${pr.changed_files} changed files were fetched`);

  async function raw(path:string,sha:string):Promise<string|undefined>{const r=await http(`https://raw.githubusercontent.com/${repoPath}/${sha}/${encodePath(path)}`,{headers:token?{authorization:`Bearer ${token}`}:{},cache:'no-store'});
    if(r.status===404)return undefined;if(!r.ok)throw new PlaygroundError(`Could not read ${path} at ${sha.slice(0,8)} (${r.status})`,502);return r.text()}
  // Head snapshot: source files for the code graph, manifests for import resolution, and every changed file.
  const changed=new Set(listed.map(f=>String(f.filename)));
  const tar=await http(`https://api.github.com/repos/${repoPath}/tarball/${head.sha}`,{headers,redirect:'follow',cache:'no-store'});
  if(!tar.ok||!tar.body)throw new PlaygroundError(`Could not download the repository snapshot (${tar.status})`,502);
  const snapshot=await readTarGz(Readable.fromWeb(tar.body as any),{stripComponents:1,filter:(p,size)=>size<=MAX_SOURCE_BYTES&&(changed.has(p)||!!languageFor(p)||isGraphConfig(p)||/(^|\/)(\.openreview\.ya?ml|greptile\.json)$/.test(p))});
  if(snapshot.truncated)notes.push('Repository snapshot was larger than the playground limit; the code graph covers part of it');

  const files=listed.map(f=>({path:String(f.filename),status:statusOf(f.status),additions:Number(f.additions)||0,deletions:Number(f.deletions)||0}));
  const snapshots:Snapshot[]=[];
  for(let i=0;i<listed.length;i+=8)snapshots.push(...await Promise.all(listed.slice(i,i+8).map(async(f):Promise<Snapshot>=>{const path=String(f.filename),status=statusOf(f.status);
    const before=status==='A'?null:(await raw(String(f.previous_filename??path),mergeBase))??null,after=status==='D'?null:snapshot.files.get(path)?.toString('utf8')??null;
    return {path,status,patch:typeof f.patch==='string'?f.patch:undefined,before,after}})));
  // Configuration is always read from the base revision; the head snapshot only tells us where nested files may live.
  const configPaths=[...snapshot.files.keys()].filter(p=>/(^|\/)(\.openreview\.ya?ml|greptile\.json)$/.test(p));
  const config:ConfigSource={list:async()=>configPaths,read:path=>raw(path,base.sha)};
  const headFiles=new Map([...snapshot.files].filter(([p])=>!!languageFor(p)||isGraphConfig(p)));
  return {ref,title:String(pr.title??''),url:String(pr.html_url??''),base,head,files,snapshots,headFiles,config,notes};
}
