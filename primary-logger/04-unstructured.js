// 04 — Problem #3: Unstructured text can't be searched or aggregated.
//
// Run:  node 04-unstructured.js
//
// In production your logs don't go to a terminal — they go to a tool
// like Datadog, Splunk, CloudWatch, or the ELK stack. Those tools index
// FIELDS. "user_id:42 AND status:declined" is a query. A free-form
// English sentence is not.

const userId = 42;
const amount = 150;
const status = 'declined';

// Unstructured: every developer phrases it differently.
console.log('User ' + userId + ' was charged $' + amount + ' - ' + status);
console.log('charge failed for 42, amount=150');
console.log('Payment problem!! user42 150usd DECLINED');

// Three logs about the SAME kind of event, three different formats.
// Now try to answer: "how many charges were declined today?"
// You'd have to write a different regex for each variant. Good luck.
//
// Structured (what we want) — same event, machine-parseable:
console.log(
  JSON.stringify({
    event: 'charge',
    user_id: userId,
    amount,
    status,
  })
);

// With structured JSON, the question becomes a one-line filter:
//   event:"charge" AND status:"declined"
// and you can graph it, alert on it, and count it. Strings give you none of that.
