// 02 — Problem #1: No levels. Everything is equally loud.
//
// Run:  node 02-no-levels.js
//
// console.log has no concept of "this is just debug noise" vs
// "this is a CRITICAL ERROR". A payment failure looks identical to
// a routine heartbeat. You cannot filter, you cannot prioritize.

function processOrders() {
  console.log('starting batch'); // who cares
  for (let i = 1; i <= 8; i++) {
    console.log('processing order ' + i); // pure noise at scale
    if (i === 5) {
      // THIS is the line that matters at 3am. It's buried.
      console.log('PAYMENT DECLINED for order ' + i);
    }
    console.log('order ' + i + ' loop iteration finished'); // noise
  }
  console.log('batch complete');
}

processOrders();

// Notice: the one line you actually care about is drowned by 17 others.
// In production with millions of lines/hour, "grep for the problem"
// becomes "find a needle in a haystack made of needles."
//
// A real logger gives you levels: debug / info / warn / error.
// You ship at INFO, the noise (debug) disappears, and errors stand out.

// ============================================================
// IMPROVED VERSION — same logic, but every line has a LEVEL.
//
// Try it both ways and watch the noise disappear with NO code change:
//   LOG_LEVEL=debug node 02-no-levels.js   <- dev: see everything
//   LOG_LEVEL=info  node 02-no-levels.js   <- prod: noise gone, error stays
//   LOG_LEVEL=error node 02-no-levels.js   <- only the problem shows
// ============================================================

const log = require('./logger');

function processOrdersImproved() {
  log.info('starting batch'); // milestone — worth keeping in prod

  for (let i = 1; i <= 8; i++) {
    log.debug('processing order', { order: i }); // noise -> hidden in prod

    if (i === 5) {
      // This now stands out as a real ERROR you can filter & alert on.
      log.error('payment declined', { order: i });
    }

    log.debug('order loop iteration finished', { order: i }); // noise -> hidden
  }

  log.info('batch complete');
}

console.log('\n===== IMPROVED (levels) — LOG_LEVEL=' + (process.env.LOG_LEVEL || 'info') + ' =====');
processOrdersImproved();

// The point: the "noise" is now log.debug and the critical line is log.error.
// In production (LOG_LEVEL=info) the 16 noise lines VANISH and the one line
// that matters is left alone — and it's tagged level:"error" so a log tool
// can alert on it. Same code, controlled by one env var.
