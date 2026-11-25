import { execFileSync } from 'node:child_process';

const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();

if (branch !== 'main') {
  console.error(`Refusing to commit: current branch is "${branch}", not "main".`);
  process.exitCode = 1;
} else {
  execFileSync('git', ['add', '-A'], { stdio: 'inherit' });
  execFileSync('git', [
    'commit',
    '-m',
    'Update project',
    '-m',
    'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>',
  ], { stdio: 'inherit' });
  execFileSync('git', ['push', 'origin', 'main'], { stdio: 'inherit' });
}
