#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const cacheBust = 'ulttra-cockpit-landing-20260606';

if (args.length !== 1 && args.length !== 2) {
  console.error('Usage: patch-chairman-login-redirect.mjs <directus-app-entry.js> OR <admin-index.html> <directus-assets-dir>');
  process.exit(1);
}

const before =
  'let n=new URL(window.location.origin);n.pathname=`${$o()}auth/login/${e.name}`;let r=new URL(window.location.href);return r.searchParams.set(`continue`,``),n.searchParams.set(`redirect`,r.toString()),o.value&&n.searchParams.set(`otp`,o.value),{name:e.name,label:e.label||ki(e.name),link:n.toString(),icon:e.icon??`account_circle`}});';

const after =
  'let n=new URL(window.location.origin);n.pathname=`${$o()}auth/login/${e.name}`;let r=new URL(window.location.href),i=new URL(`${$o()}admin/ulttra-dashboard`,window.location.origin);return r.searchParams.set(`continue`,``),n.searchParams.set(`redirect`,e.name===`chairman`?i.toString():r.toString()),o.value&&n.searchParams.set(`otp`,o.value),{name:e.name,label:e.label||ki(e.name),link:n.toString(),icon:e.icon??`account_circle`}});';

if (args.length === 1) {
  patchLoginAsset(args[0]);
} else {
  const [indexHtmlPath, assetsDir] = args;
  const jsPaths = listJavaScriptFiles(assetsDir);
  const candidates = jsPaths.filter((filePath) => readFileSync(filePath, 'utf8').includes(before));
  const alreadyPatched = jsPaths.filter((filePath) => readFileSync(filePath, 'utf8').includes(after));

  if (candidates.length === 1) {
    patchLoginAsset(candidates[0]);
    cacheBustAssetReferences(indexHtmlPath, jsPaths, basename(candidates[0]));
  } else if (candidates.length === 0 && alreadyPatched.length === 1) {
    cacheBustAssetReferences(indexHtmlPath, jsPaths, basename(alreadyPatched[0]));
  } else {
    throw new Error(`${assetsDir}: expected one Chairman redirect patch target, found ${candidates.length}`);
  }
}

function patchLoginAsset(filePath) {
  const input = readFileSync(filePath, 'utf8');
  const count = input.split(before).length - 1;

  if (count !== 1) {
    throw new Error(`${filePath}: expected one Chairman redirect patch target, found ${count}`);
  }

  writeFileSync(filePath, input.replace(before, after));
}

function listJavaScriptFiles(dirPath) {
  const entries = readdirSync(dirPath);
  return entries
    .map((entry) => join(dirPath, entry))
    .filter((filePath) => statSync(filePath).isFile() && filePath.endsWith('.js'));
}

function cacheBustAssetReferences(indexHtmlPath, jsPaths, assetName) {
  const replacement = `${assetName}?v=${cacheBust}`;
  const targetFiles = [indexHtmlPath, ...jsPaths];
  let count = 0;

  for (const filePath of targetFiles) {
    const input = readFileSync(filePath, 'utf8');
    const output = input.replaceAll(assetName, replacement);
    if (output !== input) {
      count += input.split(assetName).length - 1;
      writeFileSync(filePath, output);
    }
  }

  if (count === 0) {
    throw new Error(`${assetName}: expected at least one asset reference to cache-bust`);
  }
}
