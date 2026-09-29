import { Config, inlinePayload, renderSummary, type Review, type ReviewedFinding } from '@openreview/engine';
import type { PlaygroundResult } from './playground';

// A fixed, clearly labelled example so the output format can be inspected before a model key is configured.
const findings:ReviewedFinding[]=[
  {path:'src/billing/charge.ts',line:14,severity:'high',type:'logic',title:'Retry can charge the customer twice',scenario:'Stripe accepts the charge but the response times out, so `withRetry` calls `charges.create` again',impact:'The customer is billed twice for one order',evidence:'`charges.create` is called without an idempotency key inside `withRetry`',remediation:'Pass the order id as the idempotency key so retries are deduplicated by Stripe',ruleId:'idempotent-payments',confidence:5,fingerprint:'sample0001',
    suggestion:{startLine:14,code:'    return stripe.charges.create(params, { idempotencyKey: order.id });'}},
  {path:'src/api/checkout.ts',line:22,severity:'medium',type:'logic',title:'Error from charge is swallowed',scenario:'`charge` rejects after all retries',impact:'The order is marked paid although payment failed',evidence:'The `catch` block logs and falls through to `markPaid(order)`',remediation:'Return an error response and skip `markPaid` when the charge fails',confidence:4,fingerprint:'sample0002'},
];
const result:Review={findings,overflow:[],rejected:[],coverage:[],usage:{inputTokens:14210,outputTokens:1180,estimatedUsd:0.0061},status:'complete',
  summary:{overview:'Moves Stripe calls from the checkout handler into a new billing module and adds retries with exponential backoff for transient network errors.',
    files:[{path:'src/billing/charge.ts',change:'New wrapper around Stripe with retry and backoff'},{path:'src/api/checkout.ts',change:'Checkout now calls the billing module and marks orders paid'}],
    sequence:[{from:'Client',to:'Checkout API',message:'POST /checkout'},{from:'Checkout API',to:'Billing',message:'charge(order)'},{from:'Billing',to:'Stripe',message:'charges.create (with retry)'},{from:'Stripe',to:'Billing',message:'charge id'},{from:'Checkout API',to:'Orders DB',message:'markPaid(order)'}]}};

export function sampleResult():PlaygroundResult{
  const {body}=renderSummary(result,Config.parse({}),{head:'5a3c9e1f7b20d4c6',marker:'<!-- openreview:sample -->'});
  return {sample:true,pr:{owner:'example',repo:'shop',number:42,title:'Move Stripe calls into billing module with retries',url:'',base:'1f0e2d3c',head:'5a3c9e1f7b20d4c6'},
    files:[{path:'src/billing/charge.ts',status:'A',additions:38,deletions:0,reviewed:true},{path:'src/api/checkout.ts',status:'M',additions:9,deletions:21,reviewed:true}],
    notes:['Sample output rendered by the real formatter from a fixed example; no repository was fetched and no model was called.'],
    graph:{files:0,definitions:0,references:0,importEdges:0,ms:0},
    context:[{path:'src/api/orders.ts',reason:'Calls changed function markPaid (src/api/checkout.ts) [lines 30-41]',snippet:'  30| export async function completeOrder(id: string) {\n  31|   const order = await orders.get(id);\n  32|   await charge(order);\n  33|   return markPaid(order);\n  34| }'}],
    review:{summaryMarkdown:body,comments:findings.flatMap(f=>{const c=inlinePayload(f,[14,22]);return c?[c]:[]}),findings:2,rejected:3,status:'complete',coverage:[],usage:result.usage},timings:{}};
}
