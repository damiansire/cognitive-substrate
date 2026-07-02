#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import * as readline from 'readline';
import {
    tickLocal,
    tickGlobal,
    runDaemon,
    discoverWorkspaces,
    buildTasksScaffold,
    type WorkspaceResult
} from '@cognitive-substrate/engine';
import { cmdStatus, cmdInbox, cmdBoard, cmdSession, cmdApprove, cmdAsk } from './commands';

dotenv.config();

function promptAsync(rl: readline.Interface, question: string): Promise<string> {
    return new Promise((resolve) => rl.question(question, resolve));
}

// Nunca mover estos: secretos, manifiestos del repo, control de versiones, y la
// propia infraestructura del OS. Mover ciegamente todo el cwd (como hacía la versión
// original) podía destruir el directorio del usuario.
const PROTECTED_FROM_MOVE = new Set([
    'workspaces',
    'node_modules',
    '.git',
    '.gitignore',
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    '.env',
    '.env.example',
    '.env.local',
    'tsconfig.json',
    'tsconfig.base.json',
    'tsconfig.tsbuildinfo',
    'apps',
    'packages',
    'dist',
    'build',
    'out',
    'target',
    'README.md',
    'LICENSE',
    'docs',
    '.claude'
]);

function moveProjectToWorkspace(workspacesDir: string, projectName: string): string {
    const targetDir = path.join(workspacesDir, projectName);
    fs.mkdirSync(targetDir, { recursive: true });
    const currentDir = process.cwd();
    const items = fs.readdirSync(currentDir);

    const moved: string[] = [];
    for (const item of items) {
        // Saltear infraestructura protegida y cualquier dotfile/dir oculto.
        if (PROTECTED_FROM_MOVE.has(item) || item.startsWith('.')) continue;
        const oldPath = path.join(currentDir, item);
        const newPath = path.join(targetDir, item);
        try {
            fs.renameSync(oldPath, newPath);
            moved.push(item);
        } catch (e) {
            console.warn(`[Warning] No se pudo mover ${item}:`, e);
        }
    }
    console.log(`>>> Movidos ${moved.length} elemento(s) al workspace: ${moved.join(', ') || '(ninguno)'}`);
    return targetDir;
}

function reportResults(results: WorkspaceResult[]): void {
    const actions = results.filter((r) => r.summary).map((r) => r.summary);
    if (actions.length > 0) {
        console.log('\n>>> Acciones:');
        for (const a of actions) console.log(`    ${a}`);
    }
    console.log('\n>>> Dashboard actualizado. Engine en reposo.\n');
}

async function runInteractiveWizard(): Promise<void> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log('\n🤖 Bienvenido a Cognitive Substrate OS.');
    console.log('No detecté tareas activas. ¿Cómo quieres organizar este directorio?\n');
    console.log('[1] Agente Local: Trabajar directamente en los archivos de esta carpeta.');
    console.log("[2] Daemon Global: Crear 'workspaces/' para administrar múltiples proyectos.");

    const option = await promptAsync(rl, '\nElige una opción (1 o 2): ');

    if (option.trim() === '1') {
        const task = await promptAsync(rl, '\n🤖 ¿Qué quieres que programe en esta carpeta hoy?: ');
        fs.writeFileSync(path.resolve('tasks.md'), buildTasksScaffold(task), 'utf8');
        console.log('\n>>> Archivos inicializados. Arrancando Agente Local...\n');
        rl.close();
        reportResults(await tickLocal(process.cwd()));
    } else if (option.trim() === '2') {
        const action = await promptAsync(
            rl,
            '\n🤖 ¿Deseas [A]gregar el proyecto actual al workspace o [N]uevo proyecto vacío? (A/N): '
        );
        const projectName = await promptAsync(rl, 'Nombre del proyecto: ');
        const task = await promptAsync(rl, '¿Qué quieres que construya hoy?: ');

        const workspacesDir = path.resolve('workspaces');
        let targetWorkspace = path.join(workspacesDir, projectName);

        if (action.trim().toLowerCase() === 'a') {
            console.log('\n>>> Moviendo archivos al workspace...');
            targetWorkspace = moveProjectToWorkspace(workspacesDir, projectName);
        } else {
            fs.mkdirSync(targetWorkspace, { recursive: true });
        }

        fs.writeFileSync(path.join(targetWorkspace, 'tasks.md'), buildTasksScaffold(task), 'utf8');
        console.log('\n>>> Estructura Global creada. Arrancando Daemon...\n');
        rl.close();
        reportResults(await tickGlobal(process.cwd()));
    } else {
        console.log('Opción inválida.');
        rl.close();
    }
}

/** Detects whether this directory is a local-agent workspace or a global daemon root. */
function detectMode(rootDir: string): 'local' | 'global' | 'empty' {
    if (fs.existsSync(path.resolve(rootDir, 'tasks.md')) || fs.existsSync(path.resolve(rootDir, 'goal.md'))) {
        return 'local';
    }
    const workspacesDir = path.resolve(rootDir, 'workspaces');
    if (fs.existsSync(workspacesDir) && discoverWorkspaces(workspacesDir).length > 0) {
        return 'global';
    }
    return 'empty';
}

/** Single-tick entrypoint: run one pass and refresh the dashboard, or launch the wizard. */
export async function runEngine(): Promise<void> {
    console.log('\n>>> [Cognitive Substrate OS] Iniciando...');
    const rootDir = process.cwd();
    const mode = detectMode(rootDir);

    if (mode === 'local') {
        console.log('>>> Modo: Agente Local detectado.');
        reportResults(await tickLocal(rootDir));
    } else if (mode === 'global') {
        console.log('>>> Modo: Daemon Global detectado.');
        reportResults(await tickGlobal(rootDir));
    } else {
        await runInteractiveWizard();
    }
}

/** Continuous daemon entrypoint (`--daemon`): ticks until Ctrl-C. */
async function runDaemonCli(): Promise<void> {
    const rootDir = process.cwd();
    const mode = detectMode(rootDir);
    if (mode === 'empty') {
        console.log('>>> No hay tareas ni workspaces. Corré sin --daemon para usar el asistente.');
        return;
    }
    const controller = new AbortController();
    process.on('SIGINT', () => {
        console.log('\n>>> Señal de apagado recibida. Terminando el tick actual...');
        controller.abort();
    });
    console.log(`>>> [Daemon] Modo ${mode}. Ctrl-C para detener.`);
    await runDaemon({ rootDir, mode: mode === 'local' ? 'local' : 'global', signal: controller.signal });
    console.log('>>> [Daemon] Detenido limpiamente.');
}

const KNOWN_COMMANDS = new Set(['status', 'inbox', 'board', 'session', 'approve', 'ask']);

/** Dispatches the real subcommands (status/inbox/board/session/approve/ask). */
async function runCommand(sub: string, rest: string[]): Promise<void> {
    const rootDir = process.cwd();
    switch (sub) {
        case 'status':
            cmdStatus(rootDir);
            return;
        case 'inbox':
            cmdInbox(rootDir);
            return;
        case 'board':
            cmdBoard(rootDir);
            return;
        case 'session':
            cmdSession(rootDir, rest[0]);
            return;
        case 'approve': {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            try {
                await cmdApprove(rootDir, rest[0], (q) => promptAsync(rl, q));
            } finally {
                rl.close();
            }
            return;
        }
        case 'ask': {
            const text = rest.join(' ').trim();
            if (!text) {
                console.log('Uso: cognitive-os ask "<texto en lenguaje natural>"');
                return;
            }
            const result = await cmdAsk(rootDir, text);
            if (result.message) console.log(result.message);
            if (result.interpretation) {
                console.log(
                    `   (interpretado como: ${result.interpretation.verb} / ${result.interpretation.mode}, confianza ${result.interpretation.confidence.toFixed(2)})`
                );
            }
            return;
        }
    }
}

if (require.main === module) {
    const argv = process.argv.slice(2);
    const sub = argv[0];

    const run =
        sub && KNOWN_COMMANDS.has(sub)
            ? runCommand(sub, argv.slice(1))
            : argv.includes('--daemon')
              ? runDaemonCli()
              : runEngine();

    run.catch((e) => {
        console.error('>>> [Fatal]:', e);
        process.exit(1);
    });
}
