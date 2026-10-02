// The Java modules the installer's jlink runtime carries (tools/package.ts):
// the ones RARS and the engine need (probe/REPORT.md: java.desktop cannot be
// left out without changing RARS).  tools/check-java-modules.ts checks that
// the engine needs no other: a class from outside them (java.util.logging is
// java.logging) works with the JDK and dies in the installed app.
export const JAVA_MODULES = ['java.base', 'java.prefs', 'java.desktop'];
