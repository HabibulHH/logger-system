// 03 — Problem #2: No context. WHEN? WHICH request? WHICH server?
//
// Run:  node 03-no-context.js   (try running it twice, fast)
//
// console.log prints a bare string. No timestamp, no request id,
// no service name, no hostname. When two requests interleave (which
// they ALWAYS do in async Node), the logs become unreadable.


function handle(reqName) {
  console.log('auth check');
  setTimeout(() => {
    console.log('db query');
    setTimeout(() => {
      console.log('response sent');
    }, Math.random() * 20);
  }, Math.random() * 20);
}

// Two requests arrive at nearly the same time (normal in any server):
handle('request-A');
handle('request-B');

// Output looks like:
//   auth check
//   auth check
//   db query
//   response sent
//   db query
//   response sent
//
// QUIZ FOR STUDENTS: which "db query" belongs to which request?
// You CAN'T tell. There's no timestamp and no request id. In a real
// incident you need to trace ONE user's journey through the logs,
// and console.log makes that impossible.
