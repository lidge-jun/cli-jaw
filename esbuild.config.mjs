// esbuild configuration for frontend bundle
import { build, context } from 'esbuild';
import { existsSync } from 'fs';
import { resolve, dirname, join } from 'path';

const isWatch = process.argv.includes('--watch');

/**
 * Plugin: resolve .js import specifiers to .ts files
 * TypeScript convention uses .js extensions in imports even for .ts source files.
 * After full TS migration, the .js files no longer exist — this plugin maps them to .ts.
 */
const tsResolvePlugin = {
  name: 'ts-resolve',
  setup(b) {
    b.onResolve({ filter: /\.js$/ }, (args) => {
      // Only handle relative imports from our source files
      if (!args.path.startsWith('.')) return;
      const tsPath = args.path.replace(/\.js$/, '.ts');
      // args.resolveDir is the directory to resolve from
      const resolved = join(args.resolveDir, tsPath);
      if (existsSync(resolved)) {
        return { path: resolve(resolved) };
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
