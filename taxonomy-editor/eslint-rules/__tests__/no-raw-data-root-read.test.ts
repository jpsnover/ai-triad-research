// Rule-level Gate Verification for local/no-raw-data-root-read (t/3093).
// RuleTester uses the default espree parser (no TS projectService), so this is the
// deterministic both-arms proof: `invalid` = the FAIL arm (every realistic remnant shape
// fires), `valid` = the precision arm (non-data-root reads + sanctioned patterns stay silent).
import { describe, it, afterAll } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../no-raw-data-root-read.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.afterAll = afterAll;

const rt = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

rt.run('no-raw-data-root-read', rule, {
  valid: [
    // non-data-root base paths — not one of the 4 resolvers
    "import fs from 'fs'; import path from 'path'; fs.readFileSync(path.join(getProjectRoot(), 'x'));",
    "import fs from 'fs'; import path from 'path'; fs.readFileSync(path.join(__dirname, 'package.json'));",
    "import fs from 'fs'; fs.readFileSync('literal/path.json');",
    // cross-function wrapper — the documented KNOWN LIMITATION (closed by t/3094 convention, not this rule)
    "import fs from 'fs'; const p = makePath(); fs.readFileSync(p);",
    // backend.readFile is the sanctioned data-root path — must NOT be treated as a raw fs read
    "const p = resolveDataPath('x'); backend.readFile(p);",
  ],
  invalid: [
    // direct resolver call
    { code: "import fs from 'fs'; fs.readFileSync(getEmbeddingsPath());", errors: [{ messageId: 'rawDataRootRead' }] },
    // one-hop const (aiBackends.ts:557 shape)
    { code: "import fs from 'fs'; const p = getEmbeddingsPath(); fs.promises.readFile(p);", errors: [{ messageId: 'rawDataRootRead' }] },
    // member-form resolver + 2-hop path.join const chain (sources.ts:52 shape)
    { code: "import fs from 'fs'; import path from 'path'; const d = fileIO.getTaxonomyDir(); const f = path.join(d, 'x'); fs.readFileSync(f);", errors: [{ messageId: 'rawDataRootRead' }] },
    // inline path.join(getDataRoot(), …)
    { code: "import fs from 'fs'; import path from 'path'; fs.readFileSync(path.join(getDataRoot(), 'x'));", errors: [{ messageId: 'rawDataRootRead' }] },
    // for-of over a same-scope const array of resolver paths (server.ts:443 authorized-users shape)
    { code: "import fs from 'fs'; import path from 'path'; const candidates = [path.join(getDataRoot(), 'a')]; for (const p of candidates) { fs.readFileSync(p); }", errors: [{ messageId: 'rawDataRootRead' }] },
  ],
});
