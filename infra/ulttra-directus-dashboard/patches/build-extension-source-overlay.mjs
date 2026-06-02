#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [moduleEntryPath, outputPath] = process.argv.slice(2);

if (!moduleEntryPath || !outputPath) {
  console.error('Usage: build-extension-source-overlay.mjs <module-dist-index.js> <output-sources-index.js>');
  process.exit(1);
}

const replacements = [
  [
    "import { defineComponent, h, onMounted, onUnmounted, ref, resolveComponent } from 'vue';",
    "import { defineComponent, h, onMounted, onUnmounted, ref, resolveComponent } from '/admin/assets/vue.C7rYGRBh.entry.js';",
  ],
  [
    "import { useApi } from '@directus/extensions-sdk';",
    "import { useApi } from '/admin/assets/@directus_extensions-sdk.DKiDK8qF.entry.js';",
  ],
];

let output = readFileSync(moduleEntryPath, 'utf8');

for (const [before, after] of replacements) {
  const count = output.split(before).length - 1;
  if (count !== 1) {
    throw new Error(`${moduleEntryPath}: expected one occurrence of ${JSON.stringify(before)}, found ${count}`);
  }
  output = output.replace(before, after);
}

const exportDefault = 'export default {';
const exportCount = output.split(exportDefault).length - 1;
if (exportCount !== 1) {
  throw new Error(`${moduleEntryPath}: expected one default module export, found ${exportCount}`);
}

output = output.replace(exportDefault, 'var module0 = {');
output += [
  '',
  'const interfaces = [];',
  'const displays = [];',
  'const layouts = [];',
  'const modules = [module0];',
  'const panels = [];',
  'const themes = [];',
  'const operations = [];',
  '',
  'export { displays, interfaces, layouts, modules, operations, panels, themes };',
  '',
].join('\n');

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, output);
