// Bootstrap types. `pnpm exec convex codegen` replaces this after connecting a deployment.
import type {DataModelFromSchemaDefinition} from 'convex/server';
import schema from '../schema.js';
export type DataModel=DataModelFromSchemaDefinition<typeof schema>;
