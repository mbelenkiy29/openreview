import { defineSchema,defineTable } from 'convex/server';
import { v } from 'convex/values';
export default defineSchema({
  deliveries:defineTable({delivery:v.string(),created:v.number()}).index('by_delivery',['delivery']),
  jobs:defineTable({key:v.string(),installation:v.number(),owner:v.string(),repo:v.string(),number:v.number(),head:v.string(),base:v.string(),status:v.string(),created:v.number(),leaseUntil:v.optional(v.number()),fence:v.number(),attempts:v.number(),summaryId:v.optional(v.number()),lastError:v.optional(v.string()),result:v.optional(v.string())}).index('by_key',['key']).index('by_status',['status']),
  budgets:defineTable({key:v.string(),reserved:v.number(),spent:v.number()}).index('by_key',['key']),
  feedback:defineTable({job:v.id('jobs'),fingerprint:v.string(),kind:v.string(),user:v.string(),created:v.number()}).index('by_job',['job']),
});
