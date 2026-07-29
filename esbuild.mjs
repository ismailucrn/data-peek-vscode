import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const builds = [
  {
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    sourcemap: true,
    logLevel: 'info'
  },
  {
    entryPoints: ['src/profileWorker.ts'],
    bundle: true,
    outfile: 'dist/profileWorker.js',
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    sourcemap: true,
    logLevel: 'info'
  },
  {
    entryPoints: ['media/main.ts'],
    bundle: true,
    outfile: 'dist/webview.js',
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
    logLevel: 'info'
  }
];

if (watch) {
  const contexts = await Promise.all(builds.map((options) => esbuild.context(options)));
  await Promise.all(contexts.map((context) => context.watch()));
  console.log('Watching extension and webview sources...');
} else {
  await Promise.all(builds.map((options) => esbuild.build(options)));
}
