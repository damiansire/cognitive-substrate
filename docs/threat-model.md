# Threat model del sandbox

Este documento cubre qué puede hacer un agente malicioso o mal instruido
dentro de `cognitive-substrate-os`, qué protege el sandbox actual, y qué NO
protege todavía. Se basa en el código real de `packages/governance` y
`packages/sandbox-*`, no en aspiración.

## Activos sensibles

- **Filesystem del host**: el motor es "filesystem-first" — todo el estado es
  un archivo en disco. Un escape de sandbox con capacidad de escritura fuera
  de las raíces permitidas puede modificar cualquier archivo accesible por el
  proceso del usuario que corre el engine.
- **Credenciales/tokens de API**: cualquier variable de entorno o archivo de
  config con la API key de Gemini u otros secretos, si un agente logra leerlos
  y exfiltrarlos (por ejemplo, vía una llamada de red no controlada).
- **Comandos de terminal**: `sandbox-terminal` expone ejecución de comandos —
  el vector de mayor impacto si no está bien acotado.
- **Egress de red**: `sandbox-browser` permite que un agente navegue/haga
  requests — el vector de exfiltración de datos si no hay allowlist.

## Vectores de ataque considerados y cubiertos (con test real)

Verificado en `packages/evals/src/cases.ts` (casos `adversarial-*`, trackeados
en git, no solo documentados):

- **Escape de sandbox por lectura fuera de raíz** (`adversarial-fs-read-escape`):
  intento de leer un archivo fuera de las raíces permitidas del sandbox de
  filesystem, con `../` u otra técnica de path traversal.
- **Escape de sandbox por escritura fuera de raíz**
  (`adversarial-fs-write-escape`): mismo vector, para escritura.
- **Inyección vía lectura de skills** (`adversarial-skill-read-injection`):
  intento de leer secretos fuera de las raíces designadas para skills.
- **Comando destructivo en terminal** (`adversarial-terminal-destructive`):
  confirma que un comando destructivo (ej. borrado masivo) queda bloqueado.
- **Gate de governance** (`adversarial-governance-gate`): confirma que el
  approval gate deniega/permite correctamente según corresponda.
- **Egress de browser** (`adversarial-browser-egress`): confirma que la
  allowlist de dominios se respeta.
- **Agotamiento de recursos por tiempo de ejecución**
  (`adversarial-resource-exhaustion`): confirma que un comando en loop
  infinito (`node -e "while(true){}"`) es abortado dentro de un límite de
  tiempo acotado. Este caso encontró un bug real al escribirlo: el timeout
  de `sandbox-terminal` (`packages/sandbox-terminal/src/index.ts`) mataba
  el proceso de shell inmediato pero dejaba huérfano (y corriendo
  indefinidamente, consumiendo CPU) al proceso real que ese shell lanzaba —
  particularmente en Windows, donde no hay limpieza de árbol de procesos
  por defecto. Se arregló: `runCommand` ahora gestiona el kill manualmente
  (`killProcessTree`) — grupo de proceso detached + `kill(-pid)` en POSIX,
  snapshot propio de PID/PPID + kill individual de cada descendiente en
  Windows (más confiable bajo carga que `taskkill /T` solo) — y la promesa
  de `runCommand` no resuelve hasta que el árbol completo está
  confirmadamente muerto. **(cso-2, cerrado)**
- **Locking de escrituras de estado concurrentes entre procesos reales**
  (`claims.multiprocess.test.ts` en `packages/engine/src`): el mecanismo de
  "task claiming" (`packages/engine/src/claims.ts`, `fs.writeFileSync` con
  flag `wx` + TTL) ya tenía cobertura in-process/secuencial
  (`behavioral-worker-claiming`), pero eso nunca probó la garantía real que
  importa: que la creación exclusiva (`wx`) es atómica cuando dos procesos
  del SO, independientes, compiten por el mismo archivo de lock al mismo
  instante. El nuevo test lanza dos procesos `node` reales (vía
  `child_process.spawn`, sincronizados a un instante compartido) que
  compiten por reclamar la misma tarea; confirma que exactamente uno gana y
  que el archivo de lock queda bien formado (no corrupto por escritura
  concurrente). El mecanismo `wx` existente resultó sólido: no hizo falta
  cambiar `claims.ts`, solo probarlo con concurrencia real. **(cso-adn-1,
  cerrado)**

## Vectores de ataque NO cubiertos todavía (gap real, no hipotético)

- **Límites de memoria** (a diferencia del tiempo de ejecución, que ya está
  cubierto arriba): `sandbox-terminal` no impone ningún límite de memoria
  al proceso que ejecuta — un comando que asigna memoria sin límite (pero
  sin loopear indefinidamente en CPU, evitando así el timeout) no está
  contenido hoy. Requeriría un límite a nivel OS (cgroups/Job Object con
  límite de memoria, o contenedor) — el timeout por sí solo no lo cubre.
- **Aislamiento real (contenedor/WASM)**: el sandboxing hoy es manual en
  TypeScript (validación de paths, allowlists), no una primitiva de
  aislamiento del sistema operativo (contenedor de un solo uso, runtime WASM
  con límites de memoria/CPU impuestos por diseño). Los tests de arriba
  confirman que la lógica de validación funciona para los casos que cubre,
  pero no hay una segunda capa de aislamiento si esa lógica tiene un bug no
  cubierto por un test. **(cso-adn-2a, trabajo de días, Fase 4)**

## Cómo se actualiza este documento

Cuando se agregue un nuevo caso `adversarial-*` a
`packages/evals/src/cases.ts`, sumarlo a la lista de "cubiertos" de arriba.
Cuando se cierre cso-2 o cso-adn-1, mover ese ítem de "no cubiertos" a
"cubiertos" con la referencia al test que lo prueba.
