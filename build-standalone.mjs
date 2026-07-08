import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const watch = process.argv.includes('--watch');
const OUT_DIR = 'dist/web';

mkdirSync(OUT_DIR, { recursive: true });

// maplibre の CSS を読み込み、HTML に直接埋め込む（単一フォルダで完結させるため）
const maplibreCss = readFileSync(require.resolve('maplibre-gl/dist/maplibre-gl.css'), 'utf-8');
const html = readFileSync('web/index.html', 'utf-8').replace('/* __MAPLIBRE_CSS__ */', maplibreCss);
writeFileSync(`${OUT_DIR}/index.html`, html);

// ショートカット定義とそのスキーマを配置（実行時に fetch し、変更をホットリロード）
writeFileSync(`${OUT_DIR}/keybindings.json`, readFileSync('web/keybindings.json', 'utf-8'));
writeFileSync(`${OUT_DIR}/keybindings.schema.json`, readFileSync('web/keybindings.schema.json', 'utf-8'));

const options = {
  entryPoints: ['src/webview/standalone.tsx'],
  bundle: true,
  outfile: `${OUT_DIR}/bundle.js`,
  format: 'iife',
  platform: 'browser',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  loader: {
    '.css': 'text',
  },
  alias: {
    'react': 'preact/compat',
    'react-dom': 'preact/compat',
  },
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log(`Watching standalone... serve with: npx serve ${OUT_DIR}`);
} else {
  await esbuild.build(options);
  console.log(`Built ${OUT_DIR}/ (index.html + bundle.js). Run: npx serve ${OUT_DIR}`);
}
