import {describe,it,expect} from 'vitest';
import {createHmac} from 'node:crypto';
import {verifyWebhook} from '../../../convex/signature.js';
describe('raw GitHub webhook HMAC',()=>{
  it('accepts the exact signed bytes and rejects changed payloads',async()=>{const body='{"action":"opened","text":"é"}',secret='fixture-secret',signature=`sha256=${createHmac('sha256',secret).update(body).digest('hex')}`;expect(await verifyWebhook(body,signature,secret)).toBe(true);expect(await verifyWebhook(body+' ',signature,secret)).toBe(false)});
  it('rejects malformed and missing signatures',async()=>{expect(await verifyWebhook('{}','sha256=invalid','secret')).toBe(false);expect(await verifyWebhook('{}','','secret')).toBe(false)});
});
