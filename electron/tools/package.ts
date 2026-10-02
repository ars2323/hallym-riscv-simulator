/* Packages the app with electron-builder.

     node tools/package.ts            Windows: the NSIS installer, one file (on Windows)
     node tools/package.ts --dir      this platform, unpacked only (a check)

   1. Stages build/package/app/: the main process bundled by esbuild
      (SPIM_BUNDLE defined: src/main/paths.ts then looks next to the bundle
      and in the package's resources), the window, the examples, the notices.
      No node_modules: everything is bundled.
   2. Stages build/package/engine/, which goes into the package's resources
      as it is (outside app.asar: java reads real files):
        runtime/   a Java runtime made by jlink from the JDK this runs with --
                   Eclipse Temurin 21.0.12+1 in CI (CLAUDE.md, "JDK"): the
                   modules RARS needs and no more (java.base, java.prefs,
                   java.desktop: probe/REPORT.md), compressed, no debug data
        rars.jar   RARS built from its pinned commit (probe/setup.sh:
                   rars-src.jar), not the released jar, which is not v1.6's source
        classes/   the engine around it (probe/src/RarsProbe.java)
   3. Runs electron-builder on it, and writes build/package/sizes.json: the
      installer and what is in it, Electron / the Java runtime / RARS / the app.

   The engine's classes must be built (probe/run.sh build) and RARS set up
   (probe/setup.sh): the SessionStart hook does both.

   The program is called Hallym RISC-V everywhere: window, About, Start menu,
   install folder, uninstall entry.  Next to the Hallym MIPS editions nothing
   is shared: its own appId, install folder (per user,
   %LOCALAPPDATA%\Programs\Hallym RISC-V), Start menu entry, uninstall entry;
   no file association (no .s), no desktop shortcut, no elevation. */

import { build as electronBuild, type Configuration } from 'electron-builder';
import * as esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { LICENSE_SOURCES } from '../src/main/paths.ts';
import { nodeOptions, rendererOptions, writeThirdParty } from './build-ui.ts';
import { JAVA_MODULES } from './java-modules.ts';

const root = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const electronVersion = JSON.parse(readFileSync(path.join(root, 'node_modules/electron/package.json'), 'utf8')).version;
const stage = path.join(root, 'build/package/app');
const at = (...p: string[]) => path.join(stage, ...p);
const dirOnly = process.argv.includes('--dir');

export const APP_ID = 'kr.ac.hallym.riscv-simulator.electron';
const engineStage = path.join(root, 'build/package/engine');
const repo = path.join(root, '..');

async function stageApp(): Promise<void> {
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  const define = { 'process.env.SPIM_BUNDLE': '"1"', 'process.env.SPIM_VERSION': JSON.stringify(pkg.version) };
  const main = await esbuild.build({ ...nodeOptions('src/main/main.ts', at('main.js')), define });
  const ui = await esbuild.build({ ...rendererOptions, outfile: at('renderer/app/app.js'), sourcemap: false });
  await writeThirdParty([ui.metafile!, main.metafile!]);

  const html = readFileSync(path.join(root, 'src/renderer/app/index.html'), 'utf8');
  const packagedHtml = html.replace('src="../../../build/renderer/app.js"', 'src="app.js"');
  if (packagedHtml === html) throw new Error('index.html: the script tag to rewrite was not found');
  writeFileSync(at('renderer/app/index.html'), packagedHtml);
  cpSync(path.join(root, 'src/renderer/app/app.css'), at('renderer/app/app.css'));
  cpSync(path.join(root, 'src/renderer/assets'), at('renderer/assets'), { recursive: true });
  cpSync(path.join(root, 'src/main/preload.cjs'), at('preload.cjs'));
  cpSync(path.join(root, 'src/examples'), at('examples'), { recursive: true });
  for (const [name, source] of Object.entries(LICENSE_SOURCES)) cpSync(path.join(root, source), at('licenses', name));

  writeFileSync(at('package.json'), JSON.stringify({
    // An npm name (no blanks, lower case); the install folder is still
    // called "Hallym RISC-V": packaging/installer.nsh sets it.
    name: 'hallym-riscv', productName: 'Hallym RISC-V', version: pkg.version,
    description: 'RISC-V simulator for Hallym University (the RARS 1.6 engine)',
    author: 'AIAC Lab, Hallym University', license: 'SEE LICENSE IN NOTICE.txt', type: 'module', main: 'main.js',
  }, null, 1));
}

// The JDK running this script: its jlink, and its version for the record.
function jdk(): { jlink: string; release: string } {
  const home = process.env.JAVA_HOME;
  const exe = (name: string) => (home ? path.join(home, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name);
  const release = home && existsSync(path.join(home, 'release')) ? readFileSync(path.join(home, 'release'), 'utf8') : '';
  return { jlink: exe('jlink'), release };
}

function stageEngine(): void {
  rmSync(engineStage, { recursive: true, force: true });
  mkdirSync(engineStage, { recursive: true });
  const { jlink, release } = jdk();
  execFileSync(jlink, ['--add-modules', JAVA_MODULES.join(','), '--strip-debug', '--no-man-pages', '--no-header-files',
    '--compress=zip-9', '--output', path.join(engineStage, 'runtime')], { stdio: 'inherit' });
  const version = /JAVA_RUNTIME_VERSION="([^"]+)"/.exec(release)?.[1] ?? /JAVA_VERSION="([^"]+)"/.exec(release)?.[1] ?? '?';
  const vendor = /IMPLEMENTOR="([^"]+)"/.exec(release)?.[1] ?? '?';
  console.log(`engine: jlink runtime from ${vendor} ${version}`);
  const rarsHome = process.env.RARS_HOME ?? path.join(os.homedir(), '.cache', 'hallym-riscv', 'rars');
  const jar = path.join(rarsHome, 'rars-src.jar');
  if (!existsSync(jar)) throw new Error(`no ${jar}: run probe/setup.sh (the SessionStart hook does)`);
  cpSync(jar, path.join(engineStage, 'rars.jar'));
  const classes = path.join(repo, 'probe/build/classes');
  if (!existsSync(path.join(classes, 'RarsProbe.class'))) throw new Error(`no ${classes}/RarsProbe.class: run probe/run.sh build`);
  cpSync(classes, path.join(engineStage, 'classes'), { recursive: true });
  writeFileSync(path.join(engineStage, 'runtime.txt'), `${vendor} ${version}\nmodules: ${JAVA_MODULES.join(' ')}\n`);
}

const bytes = (p: string): number => {
  const s = statSync(p);
  return s.isDirectory() ? readdirSync(p).reduce((n, e) => n + bytes(path.join(p, e)), 0) : s.size;
};

export const config: Configuration = {
  appId: APP_ID,
  productName: 'Hallym RISC-V',
  executableName: 'HallymRISCV',
  electronVersion,
  directories: { app: stage, output: path.join(root, 'dist'), buildResources: path.join(root, 'packaging') },
  // Only the staged files: everything the program uses is in its bundles
  // (electron-builder would otherwise add the repository's dependencies).
  files: ['**/*', '!node_modules/**'],
  publish: null,
  asar: true,
  electronLanguages: ['ko', 'en-US'], // Chromium's UI strings: Korean, and its fallback
  npmRebuild: false,
  nodeGypRebuild: false,
  // The notices go with the program, next to the executable as well as in About (NOTICE: RARS
  // and JSoftFloat (MIT), the Java runtime, the university's assets, the fonts and icons).
  extraFiles: [{ from: path.join(root, '../NOTICE'), to: 'NOTICE.txt' }],
  // The engine, outside app.asar: resources/engine (src/main/paths.ts engine()).
  extraResources: [{ from: engineStage, to: 'engine' }],
  win: {
    target: ['nsis'], // the installer only: no zip from 2.1.0 on (docs/PORTING.md 13)
    icon: path.join(root, 'packaging/icons/HallymMIPS.ico'),
    signAndEditExecutable: true,
  },
  nsis: {
    // Two screens, in Korean: the progress, then "설치가 완료되었습니다" with
    // "지금 실행하기" (packaging/installer.nsh).  Still per user, with no
    // choice of folder or of "for all users" (either would need an
    // administrator), and /S still installs silently.
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: false,
    installerLanguages: ['ko_KR'],
    language: '1042',
    shortcutName: 'Hallym RISC-V',
    createDesktopShortcut: false,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
    runAfterFinish: true, // the finish page's "지금 실행하기", ticked
    // The finish pages' band in the app's navy with the symbol (tools/installer-art.py), not electron-builder's drawing.
    installerSidebar: path.join(root, 'packaging/installerSidebar.bmp'),
    uninstallerSidebar: path.join(root, 'packaging/uninstallerSidebar.bmp'),
    include: path.join(root, 'packaging/installer.nsh'), // its pages; no copy of the installer kept for an updater
    artifactName: 'HallymRISCV-${version}-win-x64-setup.${ext}',
    uninstallDisplayName: 'Hallym RISC-V ${version}',
  },
  linux: { target: ['dir'], icon: path.join(root, 'packaging/icons/app-256.png'), category: 'Education' },
  // No fileAssociations, no protocols: the Qt build's CI checks that .s is left alone.
};

if (import.meta.main) {
  await stageApp();
  stageEngine();
  await electronBuild({ config, dir: dirOnly, publish: 'never' });
  // What the installer is made of, measured: the unpacked program, by part, and the installer.
  const unpacked = readdirSync(path.join(root, 'dist')).map((d) => path.join(root, 'dist', d))
    .find((d) => statSync(d).isDirectory() && /unpacked$/.test(d));
  const installer = readdirSync(path.join(root, 'dist')).find((f) => /-setup\.exe$/.test(f));
  if (unpacked) {
    const resources = path.join(unpacked, 'resources');
    const total = bytes(unpacked);
    const runtime = bytes(path.join(resources, 'engine/runtime'));
    const rars = bytes(path.join(resources, 'engine/rars.jar'));
    const engineClasses = bytes(path.join(resources, 'engine/classes'));
    const app = bytes(path.join(resources, 'app.asar'));
    const sizes = {
      unpacked: total, javaRuntime: runtime, rars, engineClasses, app, electron: total - runtime - rars - engineClasses - app,
      installer: installer ? { name: installer, bytes: statSync(path.join(root, 'dist', installer)).size } : null,
      runtime: readFileSync(path.join(engineStage, 'runtime.txt'), 'utf8').trim(),
    };
    writeFileSync(path.join(root, 'build/package/sizes.json'), JSON.stringify(sizes, null, 1));
    const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
    console.log(`sizes: unpacked ${mb(total)} = Electron ${mb(sizes.electron)} + Java runtime ${mb(runtime)} + RARS ${mb(rars)} + engine ${mb(engineClasses)} + app ${mb(app)}`
      + (sizes.installer ? `; installer ${mb(sizes.installer.bytes)} (${sizes.installer.bytes} bytes)` : ''));
  }
}
