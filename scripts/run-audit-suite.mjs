import { spawn } from 'node:child_process';

const auditScripts = [
  'audit:dead',
  'audit:dup',
  'audit:smells',
  'audit:css',
];

function runScript(scriptName) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', scriptName], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    child.on('exit', (code) => {
      resolve(code ?? 1);
    });
  });
}

let hasFailures = false;

for (const scriptName of auditScripts) {
  const code = await runScript(scriptName);
  if (code !== 0) {
    hasFailures = true;
  }
}

process.exitCode = hasFailures ? 1 : 0;
