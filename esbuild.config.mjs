// esbuild configuration for frontend bundle
import { build, context } from 'esbuild';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';

const isWatch = process.argv.includes('--watch');

/**
 * Plugin: resolve .js import specifiers to .ts files
 * TypeScript convention uses .js extensions in imports even for .ts source files.
 * After full migration, the .js files no longer exist — this plugin maps them to .ts.
 */
const tsResolvePlugin = {
  name: 'ts-resolve',
  setup(build) {
    build.onResolve({ filter: /\.js$/ }, (args) => {
      if (args.kind !== 'import-statement' && args.kind !== 'dynamic-import') return;
      const tsPath = args.path.replace(/\.js$/, '.ts');
      const resolved = resolve(dirname(args.importer), tsPath);
      if (existsSync(resolved)) {
        return { path: resolved };
      }
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const config = {
  entryPoints: ['public/js/main.ts'],
  bundle: true,
  outfile: 'public/dist/bundle.js',
  format: 'esm',
  sourcemap: true,
  minify: !isWatch,
  target: ['es2020'],
  plugins: [tsResolvePlugin],
  logLevel: 'info',
};

if (isWatch) {
  const ctx = await context(config);
  await ctx.watch();
  console.log('👀 Watching for changes...');
} else {
  await build(config);
}
