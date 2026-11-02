// 公開のたびに CSS/JS の版（?v=…）とサービスワーカーのキャッシュ名を更新する。
// 古いファイルがブラウザやサービスワーカーに残って、新しい HTML と食い違うのを防ぐ。
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const v = `${stamp}-${execSync('git rev-parse --short HEAD').toString().trim()}`;

const html = readFileSync('index.html', 'utf8').replace(/(\.(?:css|js))\?v=[\w-]+/g, `$1?v=${v}`);
writeFileSync('index.html', html);
const sw = readFileSync('sw.js', 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = 'molecule-${v}';`);
writeFileSync('sw.js', sw);
console.log('version', v);
