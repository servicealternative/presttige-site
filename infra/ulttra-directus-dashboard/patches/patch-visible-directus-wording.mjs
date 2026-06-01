#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const [indexHtmlPath, entryJsPath] = process.argv.slice(2);

if (!indexHtmlPath || !entryJsPath) {
  console.error('Usage: patch-visible-directus-wording.mjs <index.html> <entry.js>');
  process.exit(1);
}

function replaceOnce(filePath, before, after) {
  const input = readFileSync(filePath, 'utf8');
  const count = input.split(before).length - 1;

  if (count !== 1) {
    throw new Error(`${filePath}: expected one occurrence of ${JSON.stringify(before)}, found ${count}`);
  }

  writeFileSync(filePath, input.replace(before, after));
}

replaceOnce(
  indexHtmlPath,
  "We're sorry but Directus doesn't work without JavaScript enabled. Please enable it to continue.",
  "We're sorry but Ulttra doesn't work without JavaScript enabled. Please enable it to continue.",
);

replaceOnce(entryJsPath, 'title:`Directus`', 'title:`ULTTRA crm`');
replaceOnce(entryJsPath, 'titleTemplate:`%s · %projectName`', 'titleTemplate:`%s`');
replaceOnce(entryJsPath, 'project_name??`Directus`', 'project_name??`ULTTRA crm`');
