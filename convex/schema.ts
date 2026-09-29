import { defineSchema,defineTable } from 'convex/server';
import { v } from 'convex/values';
export default defineSchema({
  deliveries:defineTable({delivery:v.string(),created:v.number()}).index('by_delivery',['delivery']),
  repositories:defineTable({key:v.string(),installation:v.number(),owner:v.string(),repo:v.string(),enabled:v.boolean(),reviewLimit:v.number(),monthlyLimit:v.number(),updated:v.number()}).index('by_key',['key']),
  jobs:defineTable({key:v.string(),installation:v.number(),owner:v.string(),repo:v.string(),number:v.number(),head:v.string(),base:v.string(),command:v.optional(v.string()),actor:v.optional(v.string()),question:v.optional(v.string()),status:v.string(),created:v.number(),leaseUntil:v.optional(v.number()),fence:v.number(),attempts:v.number(),summaryId:v.optional(v.number()),lastError:v.optional(v.string()),result:v.optional(v.string())}).index('by_key',['key']).index('by_status',['status']).index('by_pr',['installation','owner','repo','number']),
  budgets:defineTable({key:v.string(),reserved:v.number(),spent:v.number()}).index('by_key',['key']),
  reservations:defineTable({key:v.string(),job:v.id('jobs'),fence:v.number(),month:v.string(),amount:v.number(),settled:v.boolean()}).index('by_key',['key']).index('by_job',['job']),
  feedback:defineTable({job:v.id('jobs'),fingerprint:v.string(),kind:v.string(),user:v.string(),created:v.number()}).index('by_job',['job']),
});
