/**
 * Launcher for the database suite.
 *
 * Creates a throwaway data directory, points RUNFORM_DATA_DIR at it, loads the
 * compiled suite (which opens the database and registers its checks), and then
 * awaits the suite explicitly. Loading is synchronous on purpose: an async
 * `import()` changed the observable `fs` state of the suite's first check.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runform-test-'));
process.env.RUNFORM_DATA_DIR = tempDir;

console.log(`database suite data dir: ${tempDir}`);

const { runDatabaseSuite } = require(path.join(projectRoot, '.test-build', 'test', 'db.test.js'));

runDatabaseSuite()
  .then(() => {
    // summarize() exits the process itself, so reaching this point is a bug.
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.error('database suite finished without reporting results');
    process.exit(1);
  })
  .catch((error) => {
    console.error('database suite failed:', error);
    process.exit(1);
  });
