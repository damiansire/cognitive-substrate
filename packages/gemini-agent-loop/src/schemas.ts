export const toolDeclarations = [
    {
        name: 'readFile',
        description: 'Lee el contenido de un archivo. Las rutas son relativas a tu workspace actual.',
        parameters: {
            type: 'OBJECT',
            properties: {
                filepath: { type: 'STRING', description: 'Ruta del archivo a leer (relativa al workspace)' }
            },
            required: ['filepath']
        }
    },
    {
        name: 'writeFile',
        description: 'Escribe contenido en un archivo dentro del workspace actual.',
        parameters: {
            type: 'OBJECT',
            properties: {
                filepath: { type: 'STRING', description: 'Ruta del archivo a escribir (relativa al workspace)' },
                content: { type: 'STRING', description: 'Contenido a escribir' }
            },
            required: ['filepath', 'content']
        }
    },
    {
        name: 'listFiles',
        description: 'Lista los archivos en un directorio dentro del workspace.',
        parameters: {
            type: 'OBJECT',
            properties: {
                dirpath: { type: 'STRING', description: "Ruta del directorio (usa '.' para la raíz del workspace)" }
            },
            required: ['dirpath']
        }
    },
    {
        name: 'runCommand',
        description: 'Ejecuta un comando en la terminal (Windows).',
        parameters: {
            type: 'OBJECT',
            properties: {
                command: {
                    type: 'STRING',
                    description: 'El comando de PowerShell a ejecutar.'
                }
            },
            required: ['command']
        }
    },
    {
        name: 'fetchUrl',
        description:
            'Obtiene el texto visible de una página web (solo lectura). El dominio debe estar permitido por la política (browserAllowDomains).',
        parameters: {
            type: 'OBJECT',
            properties: {
                url: { type: 'STRING', description: 'La URL http(s) a leer.' }
            },
            required: ['url']
        }
    },
    {
        name: 'browserNavigate',
        description:
            'Abre/navega una URL en un navegador real (sesión interactiva persistente). El dominio debe estar permitido por browserAllowDomains.',
        parameters: {
            type: 'OBJECT',
            properties: { url: { type: 'STRING', description: 'URL http(s) a abrir.' } },
            required: ['url']
        }
    },
    {
        name: 'browserReadText',
        description: 'Devuelve el texto visible de la página actualmente abierta en la sesión de browser.',
        parameters: { type: 'OBJECT', properties: {} }
    },
    {
        name: 'browserClick',
        description: 'Hace click en un elemento de la página actual (selector CSS).',
        parameters: {
            type: 'OBJECT',
            properties: { selector: { type: 'STRING', description: 'Selector CSS del elemento.' } },
            required: ['selector']
        }
    },
    {
        name: 'browserType',
        description: 'Escribe texto en un campo de la página actual (selector CSS).',
        parameters: {
            type: 'OBJECT',
            properties: {
                selector: { type: 'STRING', description: 'Selector CSS del campo.' },
                text: { type: 'STRING', description: 'Texto a escribir.' }
            },
            required: ['selector', 'text']
        }
    },
    {
        name: 'browserScreenshot',
        description: 'Captura la página actual a un archivo dentro del workspace.',
        parameters: {
            type: 'OBJECT',
            properties: { filepath: { type: 'STRING', description: 'Ruta relativa del PNG dentro del workspace.' } },
            required: ['filepath']
        }
    },
    {
        name: 'readSkill',
        description: 'Lee las instrucciones completas de una Skill (habilidad) disponible.',
        parameters: {
            type: 'OBJECT',
            properties: {
                path: {
                    type: 'STRING',
                    description: 'La ruta absoluta de la skill que se desea leer.'
                }
            },
            required: ['path']
        }
    }
];
