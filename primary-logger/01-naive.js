// 01 — The naive start: console.log everywhere
//
// Run:  node 01-naive.js
//
// This looks PERFECTLY FINE for a tiny app. That's the trap.
// Every problem we hit later starts from code that looked like this.

function getUser(id) {
  console.log('getting user ' + id);
  return { id, name: 'Ada', email: 'ada@example.com' };
}

function charge(user, amount) {
  console.log('charging user');
  if (amount > 100) {
    console.log('big charge!');
  }
  return { ok: true, amount };
}

function handleRequest(id) {
  console.log('request received');
  const user = getUser(id);
  const result = charge(user, 150);
  console.log('done');
  return result;
}

for (let i = 0; i < 100000000; i++) {   

handleRequest(i);
}
// Looks readable. Now imagine 50 engineers, 2 million requests/day,
// and this pattern copied into 400 files. Run the next scripts to see
// what breaks.
