import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const checklistPath = resolve(process.cwd(), 'IMPLEMENTATION_CHECKLIST.md');
const source = readFileSync(checklistPath, 'utf8');
const taskLines = source.split(/\r?\n/).filter((line) => /^- \[[ x]\] \*\*\d{2}\.\d{2}\*\*/.test(line));
const tasks = taskLines.map((line) => {
  const match = line.match(/^- \[([ x])\] \*\*(\d{2}\.\d{2})\*\*/);
  if (!match) throw new Error(`Invalid checklist task line: ${line}`);
  return { id: match[2], checked: match[1] === 'x' };
});
const ids = tasks.map((task) => task.id);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (tasks.length !== 102) throw new Error(`Expected 102 checklist tasks, found ${tasks.length}.`);
if (new Set(ids).size !== tasks.length) throw new Error(`Duplicate checklist task IDs: ${[...new Set(duplicates)].join(', ')}.`);

const checked = tasks.filter((task) => task.checked).length;
const unchecked = tasks.length - checked;
const countLine = source.match(/Current count: (\d+) tasks — (\d+) checked, (\d+) unchecked/);
if (!countLine) throw new Error('Checklist header is missing the current count line.');
if (Number(countLine[1]) !== tasks.length || Number(countLine[2]) !== checked || Number(countLine[3]) !== unchecked) {
  throw new Error(`Checklist header is stale: header=${countLine[1]}/${countLine[2]}/${countLine[3]}, parsed=${tasks.length}/${checked}/${unchecked}.`);
}
console.log(JSON.stringify({ total: tasks.length, checked, unchecked, taskIds: ids }, null, 2));
