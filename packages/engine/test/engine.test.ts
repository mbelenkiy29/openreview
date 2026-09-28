import { describe,it,expect } from 'vitest';
import { Config,parseAddedLines,review,safePath } from '../src/index.js';
describe('review boundaries',()=>{
  it('maps added lines including removals',()=>expect(parseAddedLines('@@ -2,3 +2,4 @@\n old\n-old\n+new\n+another\n tail')).toEqual([3,4]));
  it('rejects traversal',()=>expect(()=>safePath('../secret')).toThrow());
  it('rejects invalid diff locations and duplicate findings',async()=>{const f={path:'a.ts',line:2,severity:'high',title:'Validation bypass',scenario:'Any caller sends an empty token',impact:'Private resource is disclosed',evidence:'The new guard accepts empty tokens',remediation:'Reject empty tokens before checking access'};const r=await review([{path:'a.ts',patch:'@@ -1 +1,2 @@\n old\n+new',addedLines:[2],before:'old',after:'new'}],{analyze:async()=>({findings:{findings:[f,{...f,line:9},f]},usage:{inputTokens:10,outputTokens:20,estimatedUsd:0.01}})},Config.parse({}));expect(r.findings).toHaveLength(1);expect(r.rejected).toHaveLength(2)});
});
