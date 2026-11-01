// The timeline (replay/timeline.js): one lane per session, what it did and when, and how long it waited for you.
// The kinds are the ones src/shared/timeline.js builds; the page names them here.
export default {
  kind: {
    think: 'Thinking', read: 'Reading files', edit: 'Editing files', shell: 'Running commands', web: 'Web', agent: 'Subagents',
    wait: 'Waiting for your approval', turn: 'Your turn', idle: 'Idle',
    unknown: 'Activity unconfirmed', stale: 'Connection stale', ended: 'Runtime ended',
  },
  subagent: 'subagent',
  loadFailed: "Couldn't load the timeline.",
  kpi: {
    wait: 'waiting for approval',
    waitNote: 'Time sessions spent waiting for you to click Allow or answer',
    turn: 'your turn',
    turnNote: 'Confirmed time waiting for your reply, counting at most 30 minutes each time; excludes unconfirmed, stale and ended spans',
    work: 'sessions worked',
    workNote: 'Confirmed activity across root sessions, excluding subagent totals and unconfirmed, stale or ended spans; summed time can exceed the range',
    prompts: 'prompts',
  },
  nothingYesterday: 'Nothing was recorded yesterday.',
  nothingHere: "No session worked in this range. The office only records while it's running.",
  rowWork: 'worked {time}',
  rowWait: 'waited {time} for approval',
  rowUnknown: '{time} unconfirmed',
  rowScope: 'This session only; child rows have their own totals',
  unknownNote: '{time} unconfirmed or stale; excluded from work and waiting totals',
  openSession: 'Open this session',
  sessionClosed: 'This session has closed',
  sessionClosedToast: 'This session has closed.',
  truncated: 'Too many events in this range, showing only the first part.',
  mark: { prompt: 'You sent a prompt', fail: 'Failed', aborted: 'Aborted', end: 'Runtime ended', deploy: 'Deploy' },
  // under "Timeline" in the activity panel
  waitToday: 'Claude waited {time} for you today',
  hint: 'see what each session did and how long it waited for you',
  tipClick: 'Click to replay this moment',
  demoNoReplay: "The demo can't replay yet. Open the real office to replay your sessions.",
  // the CSV export
  csvHead: 'Session,Subagent,Start,End,Seconds,Kind,Details',
  csvFile: 'my-office-timeline-{day}.csv',
  csvSaved: { one: 'Saved {n} row to your Downloads folder.', other: 'Saved {n} rows to your Downloads folder.' },
};
