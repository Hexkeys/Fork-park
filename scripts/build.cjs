'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { minify } = require('terser');

async function main() {
  const root = path.join(__dirname, '..');
  const sourcePath = path.join(root, 'index.html');
  const outputDir = path.join(root, 'dist');
  const outputPath = path.join(outputDir, 'index.html');
  let html = fs.readFileSync(sourcePath, 'utf8');
  const scripts = [...html.matchAll(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi)];
  const inline = scripts.filter((match) => !/\bsrc\s*=/.test(match[1]));
  if (inline.length === 0) throw new Error('No inline game script found to minify.');
  const target = inline[inline.length - 1];
  const result = await minify(target[2], {
    compress: true,
    mangle: true,
    format: { comments: false },
  });
  if (!result.code) throw new Error('JavaScript minification failed.');
  const minifiedTag = target[1] + result.code + target[3];
  const start = target.index;
  html = html.slice(0, start) + minifiedTag + html.slice(start + target[0].length);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, html);
  console.log('Built minified production game at dist/index.html');
}

main().catch((error) => {
  console.error('Production build failed:', error);
  process.exitCode = 1;
});
