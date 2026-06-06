#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const [indexHtmlPath, entryJsPath] = process.argv.slice(2);
const faviconHref = '/admin/favicon.ico?v=ulttra-large-20260606';
const brandScript = `<script>window.__ULTTRA_BRAND=function(){document.title="ULTTRA crm";var icon="${faviconHref}";document.querySelectorAll("link[rel~=icon]").forEach(function(link){if(!link.href.includes(icon)){link.remove();}});if(!document.querySelector("link[rel~=icon][href*=ulttra-large-20260606]")){var link=document.createElement("link");link.rel="icon";link.href=icon;link.sizes="any";document.head.appendChild(link);}};document.addEventListener("DOMContentLoaded",function(){window.__ULTTRA_BRAND();new MutationObserver(window.__ULTTRA_BRAND).observe(document.head,{childList:true,subtree:true});});</script>`;

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

function replaceOnceAny(filePath, candidates, after) {
  const input = readFileSync(filePath, 'utf8');
  const matches = candidates
    .filter((candidate) => input.includes(candidate))
    .filter((candidate, _, allMatches) => !allMatches.some((other) => other !== candidate && other.includes(candidate)));

  if (matches.length !== 1) {
    throw new Error(`${filePath}: expected one of ${JSON.stringify(candidates)}, found ${matches.length}`);
  }

  writeFileSync(filePath, input.replace(matches[0], after));
}

replaceOnceAny(
  indexHtmlPath,
  [
    "We're sorry but Directus doesn't work without JavaScript enabled. Please enable it to continue.",
    "We're sorry but Ulttra doesn't work without JavaScript enabled. Please enable it to continue.",
  ],
  "We're sorry but Ulttra doesn't work without JavaScript enabled. Please enable it to continue.",
);

replaceOnceAny(
  indexHtmlPath,
  [
    '<title>Loading&hellip;</title>',
    '<title>ULTTRA crm</title>',
    '<title>ULTTRA crm</title><link rel="icon" href="/admin/favicon.ico?v=ulttra-20260605" sizes="any">',
    '<title>ULTTRA crm</title><link rel="icon" href="/admin/favicon.ico?v=ulttra-large-20260606" sizes="any">',
  ],
  `<title>ULTTRA crm</title><link rel="icon" href="${faviconHref}" sizes="any">${brandScript}`,
);

normalizeBrandBlock(indexHtmlPath);

replaceOnceAny(entryJsPath, ['title:`Directus`', 'title:`ULTTRA crm`'], 'title:`ULTTRA crm`');
replaceOnceAny(
  entryJsPath,
  ['titleTemplate:`%s · %projectName`', 'titleTemplate:`%s • %projectName`', 'titleTemplate:`%s`', 'titleTemplate:`ULTTRA crm`'],
  'titleTemplate:`ULTTRA crm`',
);
replaceOnceAny(entryJsPath, ['project_name??`Directus`', 'project_name??`ULTTRA crm`'], 'project_name??`ULTTRA crm`');
replaceOnceAny(
  entryJsPath,
  [
    'link:l(()=>{let e;return e=u.info?.project?.public_favicon?We(u.info.project.public_favicon):u.info?.project?.project_color?rn(u.info.project.project_color,!u.info.project.project_logo):`/favicon.ico`,[{rel:`icon`,href:e}]})',
    'link:l(()=>[{rel:`icon`,href:`/admin/favicon.ico?v=ulttra-20260605`,sizes:`any`}])',
    'link:l(()=>[{rel:`icon`,href:`/admin/favicon.ico?v=ulttra-large-20260606`,sizes:`any`}])',
  ],
  'link:l(()=>[{rel:`icon`,href:`/admin/favicon.ico?v=ulttra-large-20260606`,sizes:`any`}])',
);

const entryFileName = basename(entryJsPath);
replaceOnceAny(
  indexHtmlPath,
  [
    `./assets/${entryFileName}`,
    `./assets/${entryFileName}?v=ulttra-title-favicon-20260605`,
    `./assets/${entryFileName}?v=ulttra-c1-reset-20260605`,
    `./assets/${entryFileName}?v=ulttra-cockpit-landing-20260606`,
    `./assets/${entryFileName}?v=ulttra-user-type-landing-20260606`,
  ],
  `./assets/${entryFileName}?v=ulttra-user-type-landing-20260606`,
);

const faviconPath = join(dirname(new URL(import.meta.url).pathname), 'ulttra-favicon.ico');
for (const targetPath of [
  join(dirname(indexHtmlPath), 'favicon.ico'),
  '/directus/node_modules/@directus/app/dist/favicon.ico',
  '/directus/node_modules/.pnpm/@directus+app@file+app/node_modules/@directus/app/dist/favicon.ico',
]) {
  if (existsSync(dirname(targetPath))) {
    copyFileSync(faviconPath, targetPath);
  }
}

function normalizeBrandBlock(filePath) {
  let input = readFileSync(filePath, 'utf8');
  input = input.replace(/<script>window\.__ULTTRA_BRAND=function\(\)[\s\S]*?<\/script>/g, '');
  input = input.replace(/<link rel="icon" href="\/admin\/favicon\.ico\?v=[^"]+" sizes="any">/g, '');

  const title = '<title>ULTTRA crm</title>';
  const count = input.split(title).length - 1;
  if (count !== 1) {
    throw new Error(`${filePath}: expected one ULTTRA title while normalizing favicon block, found ${count}`);
  }

  writeFileSync(filePath, input.replace(title, `${title}<link rel="icon" href="${faviconHref}" sizes="any">${brandScript}`));
}
