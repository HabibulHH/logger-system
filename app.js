// app.js — convenience runner so you can demo without remembering filenames.
//
//   node app.js          -> lists the demo steps
//   node app.js 2        -> runs 02-no-levels.js
//   node app.js fixed    -> runs 07-fixed.js
//
// (Each numbered file is also fine to run directly: node 02-no-levels.js)

const { execFileSync } = require('child_process');
const fs = require('fs');

const files = fs
  .readdirSync(__dirname)
  .filter((f) => /^\d\d-.*\.js$/.test(f))
  .sort();

const arg = process.argv[2];

if (!arg) {
  console.log('\nconsole.log at scale — demo steps:\n');
  for (const f of files) console.log('  node app.js ' + f.slice(0, 2) + '   ->  ' + f);
  console.log('\nThen the solution:  node app.js fixed   ->  07-fixed.js');
  console.log('Read README.md for the full walkthrough.\n');
  process.exit(0);
}

const match =
  arg === 'fixed'
    ? '07-fixed.js'
    : files.find((f) => f.startsWith(String(arg).padStart(2, '0')));

if (!match) {
  console.error('No demo step matches "' + arg + '". Run `node app.js` to list them.');
  process.exit(1);
}

console.log('\n$ node ' + match + '\n');
execFileSync('node', [match], { stdio: 'inherit', cwd: __dirname });
