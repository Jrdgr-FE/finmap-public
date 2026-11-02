// Explicit maintenance command; ordinary builds never modify another repository.
import { copyFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const destination = resolve(process.argv[2] || '../finhot', 'deploy/free/public');
await access(destination);
for (const file of ['fin-suite.css', 'fin-suite.js']) {
  await copyFile(new URL('../public/' + file, import.meta.url), resolve(destination, file));
}
console.log('Shared Fin UI files synchronized.');
