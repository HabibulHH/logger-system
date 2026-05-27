// students.js — a tiny in-memory "database" so the API has something to return.
// Real apps query Postgres/Mongo here; the logging story is identical.

module.exports = [
  { id: 1, name: 'Ada Lovelace', major: 'Mathematics', year: 2 },
  { id: 2, name: 'Alan Turing', major: 'Computer Science', year: 3 },
  { id: 3, name: 'Grace Hopper', major: 'Software Engineering', year: 1 },
  { id: 4, name: 'Katherine Johnson', major: 'Physics', year: 4 },
];
