import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
export default {
  // The engine and indexer are TypeScript workspace packages.
  transpilePackages: ['@openreview/engine', '@openreview/indexer'],
  // Loaded at runtime from node_modules: the tree-sitter runtime locates its .wasm grammars on disk.
  serverExternalPackages: ['@vscode/tree-sitter-wasm', 'typescript'],
  outputFileTracingRoot: root,
  outputFileTracingIncludes: {
    '/api/playground': ['./node_modules/@vscode/tree-sitter-wasm/wasm/**/*', '../../node_modules/.pnpm/@vscode+tree-sitter-wasm@*/node_modules/@vscode/tree-sitter-wasm/**/*'],
  },
  webpack(config) {
    // Workspace sources import siblings with NodeNext-style `.js` specifiers.
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};
