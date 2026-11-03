#!/usr/bin/env node
// Measures the size of a web app's production build (raw and gzip).
// Shipped with the eco-design skill so the impact review uses one reproducible
// measurement instead of an ad-hoc script written at each review.
//
// Usage: node measure-bundle.mjs [build-dir] [--json]
// Without build-dir, the first existing folder among DEFAULT_BUILD_DIRS
// (relative to the current directory) is measured.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const DEFAULT_BUILD_DIRS = ['dist', 'build', 'out', '.next/static'];
// Source maps are not downloaded by users; pre-compressed copies would be counted twice.
const IGNORED_EXTENSIONS = new Set(['.map', '.gz', '.br']);
const TOP_FILES_COUNT = 10;

const CATEGORY_BY_EXTENSION = {
  '.js': 'js', '.mjs': 'js', '.cjs': 'js',
  '.css': 'css',
  '.html': 'html', '.htm': 'html',
  '.png': 'images', '.jpg': 'images', '.jpeg': 'images', '.gif': 'images',
  '.webp': 'images', '.avif': 'images', '.svg': 'images', '.ico': 'images',
  '.woff': 'fonts', '.woff2': 'fonts', '.ttf': 'fonts', '.otf': 'fonts', '.eot': 'fonts',
};

function parseArguments(argv) {
  const positional = argv.filter((argument) => !argument.startsWith('--'));
  return { requestedDir: positional[0], asJson: argv.includes('--json') };
}

function findBuildDir(requestedDir) {
  if (requestedDir) {
    return existsSync(requestedDir) && statSync(requestedDir).isDirectory() ? requestedDir : null;
  }
  return DEFAULT_BUILD_DIRS.find((dir) => existsSync(dir) && statSync(dir).isDirectory()) ?? null;
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(entryPath);
    return entry.isFile() ? [entryPath] : [];
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function measureBuild(buildDir) {
  const files = listFiles(buildDir)
    .filter((filePath) => !IGNORED_EXTENSIONS.has(extname(filePath).toLowerCase()))
    .map((filePath) => {
      const content = readFileSync(filePath);
      return {
        // Forward slashes keep the report identical on Windows and macOS.
        path: relative(buildDir, filePath).split('\\').join('/'),
        category: CATEGORY_BY_EXTENSION[extname(filePath).toLowerCase()] ?? 'other',
        rawBytes: content.length,
        gzipBytes: gzipSync(content, { level: 9 }).length,
      };
    });

  const byCategory = {};
  for (const file of files) {
    const totals = (byCategory[file.category] ??= { files: 0, rawBytes: 0, gzipBytes: 0 });
    totals.files += 1;
    totals.rawBytes += file.rawBytes;
    totals.gzipBytes += file.gzipBytes;
  }

  return {
    buildDir: resolve(buildDir),
    fileCount: files.length,
    totalRawBytes: files.reduce((sum, file) => sum + file.rawBytes, 0),
    totalGzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0),
    byCategory,
    largestFiles: [...files].sort((a, b) => b.gzipBytes - a.gzipBytes).slice(0, TOP_FILES_COUNT),
  };
}

function printReport(report) {
  console.log(`Build: ${report.buildDir} (${report.fileCount} files)`);
  console.log(`Total: ${formatBytes(report.totalRawBytes)} raw, ${formatBytes(report.totalGzipBytes)} gzip`);
  console.log(`Total gzip bytes: ${report.totalGzipBytes}`);
  console.log('\nBy type (gzip):');
  const categories = Object.entries(report.byCategory).sort((a, b) => b[1].gzipBytes - a[1].gzipBytes);
  for (const [category, totals] of categories) {
    console.log(`  ${category.padEnd(7)} ${formatBytes(totals.gzipBytes).padStart(10)}  (${totals.files} files)`);
  }
  console.log(`\nLargest files (gzip, top ${TOP_FILES_COUNT}):`);
  for (const file of report.largestFiles) {
    console.log(`  ${formatBytes(file.gzipBytes).padStart(10)}  ${file.path}`);
  }
}

function main() {
  const { requestedDir, asJson } = parseArguments(process.argv.slice(2));
  const buildDir = findBuildDir(requestedDir);
  if (!buildDir) {
    const searched = requestedDir ? `"${requestedDir}"` : DEFAULT_BUILD_DIRS.join(', ');
    console.error(`No build directory found (searched: ${searched}). Run the production build first, or pass the output directory as argument.`);
    process.exitCode = 1;
    return;
  }
  const report = measureBuild(buildDir);
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
}

main();
