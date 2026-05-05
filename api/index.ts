// Vercel serverless functions must reside in api/ relative to the project root.
// The spanlens-server Vercel project deploys from the monorepo root, so this
// thin shim re-exports the actual handler from apps/server.
// Vercel's esbuild bundler follows the import chain and includes all dependencies.
export { default } from '../apps/server/api/index.js'
