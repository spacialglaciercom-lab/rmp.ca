#!/usr/bin/env node
/**
 * Extract CLI — single entry point for extract service commands.
 * Commands: serve, schema, sources, process.
 */
const CAC = require('cac').default || require('cac').cac;
const cli = CAC('rmp-extract');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const extractDir = __dirname;
/** Match root `dev:extract` (NODE_OPTIONS=--max-old-space-size=4096) — large GeoJSON / Overture extracts need a bigger heap. */
const NODE_HEAP_MB = "--max-old-space-size=4096";

cli
  .command('process <input>', 'Read JSON (GeoJSON FeatureCollection or polygon config) and output GeoJSON')
  .option('--format <fmt>', 'Output format (geojson)', { default: 'geojson' })
  .option('--output, -o <file>', 'Write output to file (default: stdout)')
  .action((input, options) => {
    const inputPath = path.isAbsolute(input) ? input : path.join(process.cwd(), input);
    if (!fs.existsSync(inputPath)) {
      console.error(`Error: input file not found: ${inputPath}`);
      process.exit(1);
    }
    let data;
    try {
      data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    } catch (e) {
      console.error(`Error: invalid JSON in ${inputPath}:`, e.message);
      process.exit(1);
    }
    let geojson;
    if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
      geojson = data;
    } else if (data.polygon && Array.isArray(data.polygon)) {
      console.error('Error: polygon extraction requires the extract server (use serve + WebSocket). Pass a FeatureCollection for CLI.');
      process.exit(1);
    } else {
      console.error('Error: input must be a GeoJSON FeatureCollection (type + features) or polygon config.');
      process.exit(1);
    }
    const out = JSON.stringify(geojson, null, options.format === 'geojson' ? 2 : 0);
    if (options.output) {
      const outPath = path.isAbsolute(options.output) ? options.output : path.join(process.cwd(), options.output);
      fs.writeFileSync(outPath, out, 'utf8');
      console.error(`Wrote ${geojson.features.length} features -> ${outPath}`);
    } else {
      console.log(out);
    }
  });

cli
  .command('serve', 'Start the main Overture extract server (replaces node server.js)')
  .action(() => {
    const child = spawn(process.execPath, [NODE_HEAP_MB, path.join(extractDir, "server.js")], {
      stdio: 'inherit',
      cwd: extractDir,
      env: process.env,
    });
    child.on('exit', (code) => process.exit(code != null ? code : 0));
  });

cli
  .command('schema', 'Run the schema verification script (check_schema.js)')
  .action(() => {
    const child = spawn(process.execPath, [path.join(extractDir, 'check_schema.js')], {
      stdio: 'inherit',
      cwd: extractDir,
      env: process.env,
    });
    child.on('exit', (code) => process.exit(code != null ? code : 0));
  });

cli
  .command('sources', 'Run the source license checker (check_sources.js)')
  .action(() => {
    const sourcesPath = path.join(extractDir, '..', 'check_sources.js');
    const nodePath = path.join(extractDir, 'node_modules');
    const env = { ...process.env, NODE_PATH: nodePath };
    const child = spawn(process.execPath, [sourcesPath], {
      stdio: 'inherit',
      cwd: path.join(extractDir, '..'),
      env,
    });
    child.on('exit', (code) => process.exit(code != null ? code : 0));
  });

cli.help();
cli.parse();
