# Plan de construcción y arranque

> **Resumen (es).** El plan accionable: BUILD ORDER (los 15 pasos que seguimos), el primer milestone, el diseño del programa de evals, anti-patrones, reglas de parada/no-negociables y las acciones iniciales.
>
> Parte 12 de 12 · [↩ Índice](./README.md)

---

ORDEN DE CONSTRUCCIÓN

Construí en este orden a menos que restricciones duras fuercen una secuencia de dependencias diferente:

1. Entender el runtime y las restricciones
2. Escribir el contrato de implementación
3. Crear los artefactos fundacionales
4. Construir la admisión de objetivos y el grafo de tareas
5. Construir el reclamo de workers y el loop de ejecución
6. Construir la verificación y el registro de evidencia
7. Construir la estructura de memoria y conocimiento
8. Construir el sistema de perfiles y skills
9. Construir el logging, los incidentes y la visibilidad del dashboard
10. Construir presupuestos, aprobaciones y controles de confianza
11. Construir el harness de evals
12. Construir el loop de auto-mejora
13. Agregar monitoreo proactivo y workflows recurrentes
14. Expandir a los dominios de navegador, escritorio, negocios y ciencia
15. Escalar a múltiples workers o máquinas

HIGIENE DE PIPELINE (transversal, no opcional)

Esto no es un paso más de la lista de arriba — corre en paralelo a TODOS los pasos
anteriores, desde el primer commit, no al final:

- CI que corra build + test en cada push/PR. No alcanza con que pasen en local.
- Linter/formatter configurado desde el día 1, no agregado "después".
- Cada script de `package.json` (no solo `build`/`test`) ejecutado y verificado al
  menos una vez de forma aislada — un script que nadie corre se rompe sin que nadie
  lo note.
- Si el sistema tiene modo simulación/fallback (sin API key real, sin una dependencia
  opcional instalada), marcar explícitamente en cualquier reporte de estado o de evals
  si lo verificado fue en ese modo o contra comportamiento real — son cosas distintas,
  y "tests verdes" no resuelve la ambigüedad por sí solo.

Por qué este párrafo existe: la primera construcción de este sistema terminó con 107
tests verdes y build limpio, pero sin CI, sin linter, y con un script `typecheck` roto
desde el día que se escribió (nadie lo ejecutaba aislado). No fue una falla de ejecución
del agente — el plan original simplemente no incluía nada de esto en ningún paso. Si
estás replicando este proyecto o usando este plan como plantilla para otro, no repitas
ese punto ciego: agregá higiene de pipeline a la lista de done de cada milestone, no la
asumas incluida.

DEFINICIÓN DEL PRIMER MILESTONE

El primer milestone normalmente debería probar que el sistema puede hacer todo lo siguiente de punta a punta:
- aceptar un objetivo
- descomponerlo en tareas
- rutear una tarea a un worker
- ejecutar el trabajo
- verificar el resultado
- registrar memoria
- mostrar la actividad a un humano
- aprender una cosa de la corrida

Si ese camino completo no funciona, no pretendas que la plataforma está completa.

DISEÑO DEL PROGRAMA DE EVALS

Usá múltiples categorías de evals:
- evals de capacidad para saber si el sistema puede hacer las tareas en absoluto
- evals de regresión para saber si las mejoras rompieron comportamiento viejo
- evals de comportamiento para política, alcance, incertidumbre y seguridad
- evals adversariales para prompt injection, entradas maliciosas o instrucciones ambiguas
- evals de largo horizonte para trabajo de múltiples pasos
- evals derivados de producción basados en fallas reales y near misses

Incluí ambos:
- evals offline en un harness
- evals online a partir de resultados de producción

Cuando sea posible, seguí:
- pass@1
- pass bajo pruebas repetidas
- costo-para-aprobar
- tiempo-para-aprobar
- si un humano tuvo que intervenir

ANTI-PATRONES A EVITAR

No construyas:
- una app de chat que solo finge ser un sistema operativo
- un único prompt gigante que no puede evolucionar de forma segura
- un sistema de múltiples agentes falso sin límites reales de tareas
- un sistema que dice que las tareas están completas sin verificación
- un sistema que olvida todo entre sesiones
- un sistema que no puede explicar por qué actuó
- un sistema que no puede pausarse, auditarse ni revertirse
- un sistema que optimiza demos por sobre confiabilidad
- un sistema que afirma generalidad pero solo soporta programación
- un sistema que depende de una peculiaridad de un runtime propietario
- un proyecto sin CI ni linter porque "el agente fue prolijo" — la disciplina manual no
  escala ni sobrevive a un segundo colaborador (humano o agente)
- un reporte de estado que no distingue verificación en modo simulación de verificación
  contra comportamiento real

ESTILO DE SALIDA

Sé operativo, no aspiracional.
Cuando tomes decisiones de arquitectura, registrá los tradeoffs.
Cuando crees archivos, explicá su rol en el sistema.
Cuando termines una tarea, mostrá evidencia.
Cuando algo falte, decí exactamente qué falta.
Cuando una capacidad se difiera, decí por qué.

REGLAS DE PARADA

No te detengas después de planificar a menos que el humano pida explícitamente solo planificación.
Seguí construyendo hasta que una de estas sea verdadera:
- el milestone actual está completamente implementado y verificado
- hay un bloqueador real que requiere input humano
- restricciones de presupuesto, permisos o entorno impiden un progreso seguro
- el humano pausa o redirige

Si estás bloqueado, reportá:
- el bloqueador exacto
- qué se intentó
- qué evidencia juntaste
- la decisión humana más pequeña necesaria

REGLAS NO NEGOCIABLES

- Preferí archivos transparentes por sobre contexto oculto.
- Preferí colas de tareas por sobre relatos vagos de colaboración.
- Preferí resultados medibles por sobre éxito auto-reportado.
- Preferí loops de eval de un cambio por sobre el churn impulsado por la intuición.
- Preferí el reclamo de trabajo basado en pull por sobre el control centralizado frágil cuando sea posible.
- Preferí arquitecturas portables por sobre el lock-in de proveedor.
- Preferí memoria durable por sobre memoria conversacional.
- Preferí autonomía acotada por sobre autonomía ciega.
- Preferí degradación elegante por sobre falla silenciosa.
- Preferí auto-mejora continua por sobre scaffolds estáticos.
- Preferí gates automatizados de calidad (CI + lint) por sobre la disciplina manual de
  quien construye.

ACCIONES INICIALES QUE DEBÉS TOMAR AHORA

1. Inspeccioná el workspace e inferí todo lo posible.
2. Hacé las preguntas concisas mínimas que todavía hagan falta.
3. Producí una matriz de capacidades del runtime.
4. Escribí el contrato de implementación.
5. Creá o actualizá los artefactos fundacionales.
6. Creá las colas de momentum en vivo: `now`, `next`, `blocked`, `improve` y `recurring`.
7. Definí el primer milestone y los siguientes tres milestones después de él.
8. Empezá a construir el primer milestone de inmediato.
9. Agregá verificación y captura de evidencia antes de declarar algo completo.
10. Agregá al menos una mejora de aprendizaje o de eval antes de terminar el milestone.
11. Si todavía no existe un scaffold de proyecto significativo, crealo y procedé en lugar de esperar un sistema preexistente.
12. Nunca termines la corrida sin acciones siguientes explícitas y al menos una mejora compuesta encolada.

Tu estándar de éxito no es "generé un scaffold". Tu estándar es "construí un sistema operativo agéntico durable, observable y auto-mejorante que puede expandirse con el tiempo hacia el trabajo general de computadora, con verificación, gobernanza, memoria y ejecución en el mundo real incorporadas desde el principio."
