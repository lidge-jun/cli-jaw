import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const TEST_HOME_PREFIX = 'cli-jaw-test-';

const inheritedHome = process.env.CLI_JAW_HOME || '';
const testHome = mkdtempSync(join(tmpdir(), TEST_HOME_PREFIX));

process.env.CLI_JAW_INHERITED_HOME = inheritedHome;
process.env.CLI_JAW_HOME = testHome;
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

if (!basename(process.env.CLI_JAW_HOME).startsWith(TEST_HOME_PREFIX)) {
    throw new Error(`Refusing to run tests because effective CLI_JAW_HOME is not a temp test home: ${process.env.CLI_JAW_HOME}`);
}
