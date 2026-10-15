const AdmZip = require('../node_modules/adm-zip');
const { readAppMeta } = require('../src/apkmeta.js');
const fs = require('fs');
(async () => {
  for (const f of process.argv.slice(2)) {
    const z = new AdmZip(f);
    const t = Date.now();
    const m = await readAppMeta(async (n) => { const e = z.getEntry(n); return e ? e.getData() : null; });
    const ic = m.icon || {};
    console.log(f.split('/').pop(), m.pkg, m.versionName, m.versionCode, JSON.stringify(m.label), ic.kind, Object.entries(ic).map(([k, v]) => k + '=' + (typeof v === 'string' ? v.slice(0, 40) + '…' + v.length : v)).join(' '), Date.now() - t + 'ms');
    const out = '/tmp/claude-0/-home-claude/12132115-8157-5a1e-b0c6-7c92d828b2a1/scratchpad/apks/' + f.split('/').pop() + '.icon.json';
    fs.writeFileSync(out, JSON.stringify(m.icon));
  }
})();
