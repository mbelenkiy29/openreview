import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

export type TarOptions={
  /** Keep an entry only when this returns true. Paths are after `stripComponents`. */
  filter?:(path:string,size:number)=>boolean;
  /** Leading path segments to drop, e.g. 1 for GitHub's `owner-repo-sha/` folder. */
  stripComponents?:number;
  maxFiles?:number;
  /** Stop after this many uncompressed bytes and report `truncated`. */
  maxBytes?:number;
};
export type TarResult={files:Map<string,Buffer>;truncated:boolean};

const text=(b:Buffer,start:number,end:number)=>{const s=b.subarray(start,end),z=s.indexOf(0);return (z<0?s:s.subarray(0,z)).toString('utf8')};
function octal(b:Buffer,start:number,end:number){if(b[start]&0x80){let n=0;for(let i=start+1;i<end;i++)n=n*256+b[i];return n}return parseInt(text(b,start,end).trim()||'0',8)}
function paxPath(data:Buffer){let at=0,path:string|undefined;while(at<data.length){const sp=data.indexOf(32,at);if(sp<0)break;const len=Number(data.subarray(at,sp).toString());if(!len)break;
  const record=data.subarray(sp+1,at+len-1).toString('utf8'),eq=record.indexOf('=');if(record.slice(0,eq)==='path')path=record.slice(eq+1);at+=len}return path}

/**
 * Streams a .tar.gz and returns regular files that pass `filter`. Handles ustar, pax (`x`/`g`) and GNU long-name (`L`) headers.
 * Unsafe paths (absolute, `..`, `.git`) are dropped. Nothing is written to disk.
 */
export async function readTarGz(input:AsyncIterable<Uint8Array>|NodeJS.ReadableStream,options:TarOptions={}):Promise<TarResult>{
  const {filter=()=>true,stripComponents=0,maxFiles=25_000,maxBytes=300_000_000}=options,files=new Map<string,Buffer>();
  const gunzip=(input instanceof Readable?input:Readable.from(input as AsyncIterable<Uint8Array>)).pipe(createGunzip());
  let buf:Buffer=Buffer.alloc(0),total=0,truncated=false,longName:string|undefined,paxName:string|undefined;
  // Current entry's data: bytes still to read, padding after it, and chunks when the entry is kept or is metadata.
  let entry:{remaining:number;padding:number;chunks:Buffer[]|null;kind:'file'|'pax'|'long';path:string}|undefined,ended=false;
  const finish=()=>{if(!entry)return;const data=entry.chunks&&Buffer.concat(entry.chunks);
    if(entry.kind==='pax'&&data)paxName=paxPath(data);else if(entry.kind==='long'&&data)longName=text(data,0,data.length);else if(data)files.set(entry.path,data)};
  try{for await (const chunk of gunzip){total+=chunk.length;if(total>maxBytes){truncated=true;break}buf=buf.length?Buffer.concat([buf,chunk]):chunk as Buffer;
    while(!ended){
      if(entry){const take=Math.min(entry.remaining,buf.length);if(take&&entry.chunks)entry.chunks.push(buf.subarray(0,take));entry.remaining-=take;buf=buf.subarray(take);
        if(entry.remaining>0)break;if(buf.length<entry.padding){entry.padding-=buf.length;buf=Buffer.alloc(0);break}buf=buf.subarray(entry.padding);finish();entry=undefined;continue}
      if(buf.length<512)break;const h=buf.subarray(0,512);buf=buf.subarray(512);
      if(h.every(x=>x===0)){ended=true;break}
      const type=String.fromCharCode(h[156]||48),size=octal(h,124,136),padding=(512-size%512)%512;
      const prefix=text(h,345,500),name=paxName??longName??(prefix?`${prefix}/${text(h,0,100)}`:text(h,0,100));
      if(type==='x'||type==='L'){entry={remaining:size,padding,chunks:[],kind:type==='x'?'pax':'long',path:''};continue}
      // Long names apply to the next entry only.
      paxName=undefined;longName=undefined;
      let path=name.split('/').slice(stripComponents).join('/'),keep=false;
      if((type==='0'||type==='7')&&path&&!path.startsWith('/')&&!path.split('/').some(p=>p==='..'||p==='.git')){if(files.size>=maxFiles)truncated=true;else keep=filter(path,size)}
      if(!keep)path='';entry={remaining:size,padding,chunks:keep?[]:null,kind:'file',path};
    }
    if(ended)break}}
  finally{gunzip.destroy()}
  if(entry&&entry.remaining===0)finish();
  return {files,truncated};
}
