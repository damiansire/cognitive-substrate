import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';

export interface SkillMetadata {
    name: string;
    description: string;
    path: string;
}

export function parseFrontmatter(fileContent: string): any {
    const match = fileContent.match(/^---\n([\s\S]*?)\n---/);
    if (match && match[1]) {
        try {
            return yaml.parse(match[1]);
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * The two directories skills may live in: a global per-user store and a
 * per-workspace local store. These are the ONLY roots a skill may be read from.
 */
export function getSkillRoots(workspacePath: string): string[] {
    return [
        path.join(os.homedir(), '.gemini', 'config', 'skills'),
        path.join(path.resolve(workspacePath), '.agents', 'skills')
    ];
}

function scanSkillsDirectory(dirPath: string): SkillMetadata[] {
    const skills: SkillMetadata[] = [];
    if (!fs.existsSync(dirPath)) return skills;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            const skillMdPath = path.join(dirPath, entry.name, 'SKILL.md');
            if (fs.existsSync(skillMdPath)) {
                const content = fs.readFileSync(skillMdPath, 'utf8');
                const meta = parseFrontmatter(content);
                if (meta && meta.name && meta.description) {
                    skills.push({
                        name: meta.name,
                        description: meta.description,
                        path: skillMdPath
                    });
                }
            }
        }
    }
    return skills;
}

export function discoverSkills(workspacePath: string): SkillMetadata[] {
    const [globalPath, localPath] = getSkillRoots(workspacePath);

    const globalSkills = scanSkillsDirectory(globalPath!);
    const localSkills = scanSkillsDirectory(localPath!);

    const skillMap = new Map<string, SkillMetadata>();
    for (const skill of globalSkills) {
        skillMap.set(skill.name, skill);
    }
    for (const skill of localSkills) {
        skillMap.set(skill.name, skill);
    }

    return Array.from(skillMap.values());
}

/** True if `candidate` is contained within `root` (or equal to it). */
function isInside(root: string, candidate: string): boolean {
    const rel = path.relative(path.resolve(root), path.resolve(candidate));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Reads the full content of a skill file.
 *
 * SECURITY: the model supplies `skillPath`, so we must not let it read arbitrary
 * absolute paths (e.g. ~/.ssh/id_rsa or the project's .env). The path is only
 * served if it resolves inside one of the known skill roots AND is a SKILL.md file.
 *
 * @param workspacePath - The workspace whose local skill root is allowed.
 * @param skillPath - The (untrusted) path the model asked to read.
 */
export function readSkillContent(workspacePath: string, skillPath: string): string {
    if (!skillPath) return 'Error: ruta de Skill vacía.';

    const resolved = path.resolve(skillPath);
    const roots = getSkillRoots(workspacePath);
    const allowed = roots.some((root) => isInside(root, resolved));

    if (!allowed || path.basename(resolved) !== 'SKILL.md') {
        return `Error de Seguridad: Acceso denegado. Solo se pueden leer archivos SKILL.md dentro de las raíces de skills (${roots.join(', ')}).`;
    }

    if (fs.existsSync(resolved)) {
        return fs.readFileSync(resolved, 'utf8');
    }
    return 'Error: No se pudo leer la Skill en la ruta ' + skillPath;
}
