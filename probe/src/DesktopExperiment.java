// Can RARS assemble and run without the java.desktop module, without modifying RARS?
// Run on a runtime that has java.base + java.prefs only. One mode per JVM, because
// a failed static initializer poisons the class for the rest of the process.
//
//   initialize : the normal path, Globals.initialize()
//   api        : the rars.api.Program path
//   skip       : Globals.initialize() minus `new Settings()` (fill the other public statics by hand)
//
// Prints one line: "<mode> OK ..." or "<mode> FAIL <first throwable> at <first rars frame>".

import rars.*;
import rars.api.Program;
import rars.riscv.InstructionSet;
import rars.riscv.hardware.Memory;
import rars.riscv.hardware.RegisterFile;
import rars.assembler.SymbolTable;
import rars.simulator.Simulator;

import java.util.ArrayList;

public class DesktopExperiment {
    // RARS closes System.out when a program ends, which closes fd 1 itself. Hand RARS a
    // System.out that ignores close() and keep our own handle for the verdict line.
    static final java.io.PrintStream OUT = new java.io.PrintStream(new java.io.FileOutputStream(java.io.FileDescriptor.out), true);
    static {
        System.setOut(new java.io.PrintStream(OUT, true) { @Override public void close() { flush(); } });
    }
    static final String SRC = "main: li a0, 42\n li a7, 1\n ecall\n li a7, 10\n ecall\n";

    public static void main(String[] args) {
        String mode = args.length > 0 ? args[0] : "";
        String stage = "start";
        try {
            switch (mode) {
                case "initialize": {
                    stage = "Globals.initialize";
                    Globals.initialize();
                    stage = "assemble";
                    RISCVprogram p = new RISCVprogram();
                    Globals.program = p;
                    p.fromString(SRC);
                    p.tokenize();
                    ArrayList<RISCVprogram> l = new ArrayList<>();
                    l.add(p);
                    p.assemble(l, true, false);
                    stage = "simulate";
                    RegisterFile.initializeProgramCounter(false);
                    Simulator.Reason r = Simulator.getInstance().simulate(RegisterFile.getProgramCounter(), -1, null);
                    OUT.println("\n" + mode + " OK " + r);
                    break;
                }
                case "api": {
                    stage = "new Program()";
                    Program p = new Program();
                    stage = "assembleString";
                    p.assembleString(SRC);
                    stage = "setup";
                    p.setup(new ArrayList<>(), "");
                    stage = "simulate";
                    Simulator.Reason r = p.simulate();
                    OUT.println(mode + " OK " + r + " stdout=" + p.getSTDOUT());
                    break;
                }
                case "skip": {
                    stage = "Globals statics without Settings";
                    Globals.memory = Memory.getInstance();
                    Globals.symbolTable = new SymbolTable("global");
                    Globals.instructionSet = new InstructionSet();
                    stage = "InstructionSet.populate";
                    Globals.instructionSet.populate();
                    stage = "assemble";
                    RISCVprogram p = new RISCVprogram();
                    Globals.program = p;
                    p.fromString(SRC);
                    p.tokenize();
                    ArrayList<RISCVprogram> l = new ArrayList<>();
                    l.add(p);
                    p.assemble(l, true, false);
                    stage = "simulate";
                    RegisterFile.initializeProgramCounter(false);
                    Simulator.Reason r = Simulator.getInstance().simulate(RegisterFile.getProgramCounter(), -1, null);
                    OUT.println("\n" + mode + " OK " + r);
                    break;
                }
                default:
                    OUT.println("usage: DesktopExperiment initialize|api|skip");
                    System.exit(2);
            }
        } catch (Throwable t) {
            while (t.getCause() != null) t = t.getCause();   // report the root cause
            StackTraceElement where = null;
            for (StackTraceElement e : t.getStackTrace()) {
                if (e.getClassName().startsWith("rars.")) { where = e; break; }
            }
            OUT.println(mode + " FAIL during " + stage + ": " + t + " at " + where);
            System.exit(1);
        }
    }
}
