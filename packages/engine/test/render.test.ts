import {describe,it,expect} from 'vitest';
import {Config,inlinePayload,mergeSummary,mermaidSequence,prConfidence,renderDescription,renderFinding,renderSummary,sanitize,type Review,type ReviewedFinding} from '../src/index.js';

const f=(over:Partial<ReviewedFinding>={}):ReviewedFinding=>({path:'src/a.ts',line:4,severity:'high',type:'logic',title:'Missing auth check',scenario:'Anonymous user calls it',impact:'Data leaks',evidence:'No guard',remediation:'Add guard',fingerprint:'abc123',confidence:4,...over});
const result=(over:Partial<Review>={}):Review=>({findings:[f()],overflow:[],rejected:[],coverage:[],usage:{inputTokens:1,outputTokens:1,estimatedUsd:0.0123},status:'complete',summary:{overview:'Adds an endpoint.',files:[{path:'src/a.ts',change:'New handler'}],sequence:[{from:'Client',to:'API',message:'GET /x'},{from:'API',to:'DB',message:'select'}]},...over});

describe('rendering',()=>{
  it('scores merge confidence deterministically',()=>{
    expect(prConfidence([],'complete').score).toBe(5);expect(prConfidence([f({severity:'low'})],'complete').score).toBe(5);
    expect(prConfidence([f({severity:'medium'})],'complete').score).toBe(4);expect(prConfidence([f({severity:'medium'}),f({severity:'medium'})],'complete').score).toBe(3);
    expect(prConfidence([f()],'complete').score).toBe(2);expect(prConfidence([f(),f()],'complete').score).toBe(1);expect(prConfidence([f({severity:'critical'})],'complete').score).toBe(1);
    const partial=prConfidence([],'partial');expect(partial.score).toBe(4);expect(partial.reason).toContain('not reviewed')});
  it('renders Mermaid that cannot be broken by model text',()=>{const m=mermaidSequence([{from:'Web "App"; drop',to:'API#1',message:'call: <script>; x'},{from:'API#1',to:'Web "App"; drop',message:'ok'}]);
    expect(m.split('\n')[0]).toBe('sequenceDiagram');expect(m).toContain('participant P0 as Web App drop');expect(m).toContain('P0->>P1: call script x');expect(m.replace(/->>/g,'')).not.toMatch(/[;"<>#]/)});
  it('neutralizes HTML, forged markers and mentions outside code, but keeps code readable',()=>{
    const s=sanitize('ping @octocat <!-- openreview-finding:dead --> <img src=x> and `a < b && c` or `<!-- openreview:1 -->`');
    expect(s).not.toContain('<!-- openreview');expect(s).not.toContain('<img');expect(s).toContain('@​octocat');expect(s).toContain('`a < b && c`')});
  it('builds the summary with sections, collapsible diagram and footer',()=>{const {body,summary}=renderSummary(result(),Config.parse({}),{head:'0123456789abcdef',marker:'<!-- m -->'});
    expect(body.startsWith('<!-- m -->\n## OpenReview · 01234567')).toBe(true);expect(body).toContain('### Summary\n\nAdds an endpoint.');expect(body).toContain('Confidence score: 2/5');
    expect(body).toContain('| 🟠 high | `src/a.ts:4` | logic | Missing auth check | 4/5 |');expect(body).toContain('| `src/a.ts` | New handler | 1 |');
    expect(body).toContain('<details>\n<summary><b>Sequence diagram</b></summary>\n\n```mermaid\nsequenceDiagram');expect(body).toContain('Estimated model cost: $0.0123');expect(summary?.overview).toBe('Adds an endpoint.')});
  it('honours section toggles but always lists issues',()=>{const config=Config.parse({summarySection:{included:false},issuesTable:{included:false},confidenceScore:{collapsible:true,defaultOpen:true},sequenceDiagram:{included:false}});
    const {body}=renderSummary(result(),config,{head:'h',marker:'m'});expect(body).not.toContain('Summary');expect(body).not.toContain('mermaid');expect(body).toContain('<details open>');expect(body).toContain('- **high** `src/a.ts:4`: Missing auth check')});
  it('merges incremental summaries with the previous overview',()=>{const previous={overview:'Original PR purpose.',files:[{path:'a.ts',change:'old'},{path:'b.ts',change:'kept'}]};
    const merged=mergeSummary(previous,{overview:'Fixes review comments.',files:[{path:'a.ts',change:'new'}]})!;expect(merged).toMatchObject({overview:'Original PR purpose.',latest:'Fixes review comments.',files:[{path:'a.ts',change:'new'},{path:'b.ts',change:'kept'}]});
    const {body}=renderSummary(result({summary:{overview:'Fixes review comments.',files:[]}}),Config.parse({}),{head:'bbbbbbbbbb',marker:'m',incremental:true,comparison:'aaaaaaaaaa',previous});expect(body).toContain('Original PR purpose.');expect(body).toContain('**Latest push** (`aaaaaaaa..bbbbbbbb`): Fixes review comments.')});
  it('renders suggestion blocks with a safe fence and multi-line payloads',()=>{const g=f({line:5,suggestion:{startLine:4,code:'const s = "```";\nreturn s;'}});
    expect(renderFinding(g)).toContain('````suggestion\nconst s = "```";\nreturn s;\n````');expect(renderFinding(g)).toContain('<!-- openreview-finding:abc123 -->');
    expect(inlinePayload(g,[4,5])).toMatchObject({line:5,start_line:4,start_side:'RIGHT'});
    const partial=inlinePayload(g,[5])!;expect(partial.start_line).toBeUndefined();expect(partial.body).not.toContain('suggestion');expect(inlinePayload(g,[4])).toBeNull()});
  it('renders a PR description with its marker',()=>{const d=renderDescription({overview:'Adds @team <b>x</b>.',files:[{path:'a.ts',change:'New'}]});expect(d).toContain('Adds @​team &lt;b&gt;x&lt;/b&gt;.');expect(d).toContain('- `a.ts`: New');expect(d).toContain('<!-- openreview-description -->')});
});
