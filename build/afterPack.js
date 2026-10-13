// Sets the icon and version info on the Windows .exe without needing Wine.
const fs = require('fs');
const path = require('path');
const ResEdit = require('resedit');

exports.default = async function (ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const name = ctx.packager.appInfo.productFilename;
  const exePath = path.join(ctx.appOutDir, `${name}.exe`);
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const ico = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const id = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, lang, ico.icons.map((i) => i.data));

  const v = ctx.packager.appInfo.version;
  const [vi] = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  if (vi) {
    const parts = v.split('.').map(Number);
    vi.setFileVersion(parts[0], parts[1], parts[2], 0, 1033);
    vi.setProductVersion(parts[0], parts[1], parts[2], 0, 1033);
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      FileDescription: 'ADB Connector', ProductName: 'ADB Connector', CompanyName: 'Moshe',
      OriginalFilename: `${name}.exe`, InternalName: name, LegalCopyright: '',
    });
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('  • icon + version info set on', path.basename(exePath));
};
