const path = require('path');
const { spawnSync } = require('child_process');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });
const args = ['run', '--summary-trend-stats=avg,min,med,max,p(90),p(95)', 'tests/dmoney-transactions.js', ...process.argv.slice(2)];
const result = spawnSync(process.env.K6_BIN || 'k6', args, { cwd: root, env: process.env, stdio: 'inherit', shell: process.platform === 'win32' });
if (result.error) {
  console.error(`Could not start k6: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
