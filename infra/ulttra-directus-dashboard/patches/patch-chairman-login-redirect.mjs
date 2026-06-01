#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const [entryJsPath] = process.argv.slice(2);

if (!entryJsPath) {
  console.error('Usage: patch-chairman-login-redirect.mjs <directus-app-entry.js>');
  process.exit(1);
}

const before =
  'let n=new URL(window.location.origin);n.pathname=`${$o()}auth/login/${e.name}`;let r=new URL(window.location.href);return r.searchParams.set(`continue`,``),n.searchParams.set(`redirect`,r.toString()),o.value&&n.searchParams.set(`otp`,o.value),{name:e.name,label:e.label||ki(e.name),link:n.toString(),icon:e.icon??`account_circle`}});';

const after =
  'let n=new URL(window.location.origin);n.pathname=`${$o()}auth/login/${e.name}`;let r=new URL(window.location.href),i=new URL(`${$o()}admin/ulttra-dashboard`,window.location.origin);return r.searchParams.set(`continue`,``),n.searchParams.set(`redirect`,e.name===`chairman`?i.toString():r.toString()),o.value&&n.searchParams.set(`otp`,o.value),{name:e.name,label:e.label||ki(e.name),link:n.toString(),icon:e.icon??`account_circle`}});';

const input = readFileSync(entryJsPath, 'utf8');
const count = input.split(before).length - 1;

if (count !== 1) {
  throw new Error(`${entryJsPath}: expected one Chairman redirect patch target, found ${count}`);
}

writeFileSync(entryJsPath, input.replace(before, after));
