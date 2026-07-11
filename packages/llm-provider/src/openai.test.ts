import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAiProvider, toJsonSchema, toOpenAiTools, type OpenAiChatClient } from './openai';
import type { FunctionDeclaration } from './types';

// No OPENAI_API_KEY is available in this environment, so this adapter is verified
// against an INJECTED FAKE client (never the real network) — see the class docstring
// in openai.ts for what remains unverified against the real API.

describe('toJsonSchema (Gemini-style -> JSON Schema translation)', () => {
    it('lowercases the type and keeps description', () => {
        expect(toJsonSchema({ type: 'STRING', description: 'a string' })).toEqual({
            type: 'string',
            description: 'a string'
        });
    });

    it('recurses into nested object properties and required', () => {
        const schema = toJsonSchema({
            type: 'OBJECT',
            properties: {
                filepath: { type: 'STRING', description: 'path' },
                count: { type: 'NUMBER' }
            },
            required: ['filepath']
        });
        expect(schema).toEqual({
            type: 'object',
            properties: {
                filepath: { type: 'string', description: 'path' },
                count: { type: 'number' }
            },
            required: ['filepath']
        });
    });

    it('defaults to an empty object schema when parameters are absent', () => {
        expect(toJsonSchema(undefined)).toEqual({ type: 'object', properties: {} });
    });
});

describe('toOpenAiTools', () => {
    it('translates a FunctionDeclaration array into OpenAI tool wrappers', () => {
        const decls: FunctionDeclaration[] = [
            {
                name: 'readFile',
                description: 'Reads a file',
                parameters: { type: 'OBJECT', properties: { filepath: { type: 'STRING' } }, required: ['filepath'] }
            }
        ];
        const tools = toOpenAiTools(decls);
        expect(tools).toEqual([
            {
                type: 'function',
                function: {
                    name: 'readFile',
                    description: 'Reads a file',
                    parameters: { type: 'object', properties: { filepath: { type: 'string' } }, required: ['filepath'] }
                }
            }
        ]);
    });
});

describe('OpenAiProvider.hasApiKey', () => {
    let saved: string | undefined;
    beforeEach(() => {
        saved = process.env['OPENAI_API_KEY'];
    });
    afterEach(() => {
        if (saved === undefined) delete process.env['OPENAI_API_KEY'];
        else process.env['OPENAI_API_KEY'] = saved;
    });

    it('is false when unset', () => {
        delete process.env['OPENAI_API_KEY'];
        expect(new OpenAiProvider().hasApiKey()).toBe(false);
    });

    it('is false for the placeholder value', () => {
        process.env['OPENAI_API_KEY'] = 'tu_clave_aqui';
        expect(new OpenAiProvider().hasApiKey()).toBe(false);
    });

    it('is true for a real-looking key', () => {
        process.env['OPENAI_API_KEY'] = 'sk-real-looking-key';
        expect(new OpenAiProvider().hasApiKey()).toBe(true);
    });
});

describe('OpenAiChat (via OpenAiProvider.createChat, injected fake client)', () => {
    const tools: FunctionDeclaration[] = [
        {
            name: 'readFile',
            description: 'Lee un archivo',
            parameters: { type: 'OBJECT', properties: { filepath: { type: 'STRING' } }, required: ['filepath'] }
        }
    ];

    it('sends the system + user message and returns plain text with no tool calls', async () => {
        const create = vi.fn().mockResolvedValue({
            choices: [{ message: { role: 'assistant', content: 'hola!' } }]
        });
        const fakeClient: OpenAiChatClient = { chat: { completions: { create } } };
        const provider = new OpenAiProvider('gpt-4o-mini', () => fakeClient);

        const chat = provider.createChat('eres un asistente', tools);
        const response = await chat.sendMessage({ kind: 'text', text: 'hola' });

        expect(response.text).toBe('hola!');
        expect(response.functionCalls).toBeUndefined();

        const callArgs = create.mock.calls[0][0];
        expect(callArgs.messages).toEqual([
            { role: 'system', content: 'eres un asistente' },
            { role: 'user', content: 'hola' }
        ]);
        expect(callArgs.tools[0].function.name).toBe('readFile');
    });

    it('parses tool_calls from the response into vendor-neutral AgentFunctionCall[]', async () => {
        const create = vi.fn().mockResolvedValue({
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: null,
                        tool_calls: [
                            {
                                id: 'call_1',
                                type: 'function',
                                function: { name: 'readFile', arguments: '{"filepath":"a.txt"}' }
                            }
                        ]
                    }
                }
            ]
        });
        const fakeClient: OpenAiChatClient = { chat: { completions: { create } } };
        const provider = new OpenAiProvider('gpt-4o-mini', () => fakeClient);

        const chat = provider.createChat('sys', tools);
        const response = await chat.sendMessage({ kind: 'text', text: 'lee a.txt' });

        expect(response.functionCalls).toEqual([{ id: 'call_1', name: 'readFile', args: { filepath: 'a.txt' } }]);
    });

    it('accumulates history across turns: tool results become `tool` messages tied to their call id', async () => {
        const create = vi
            .fn()
            .mockResolvedValueOnce({
                choices: [
                    {
                        message: {
                            role: 'assistant',
                            content: null,
                            tool_calls: [
                                { id: 'call_1', type: 'function', function: { name: 'readFile', arguments: '{}' } }
                            ]
                        }
                    }
                ]
            })
            .mockResolvedValueOnce({
                choices: [{ message: { role: 'assistant', content: 'listo' } }]
            });
        const fakeClient: OpenAiChatClient = { chat: { completions: { create } } };
        const provider = new OpenAiProvider('gpt-4o-mini', () => fakeClient);
        const chat = provider.createChat('sys', tools);

        await chat.sendMessage({ kind: 'text', text: 'lee algo' });
        const second = await chat.sendMessage({
            kind: 'toolResults',
            results: [{ callId: 'call_1', name: 'readFile', output: 'contenido del archivo' }]
        });

        expect(second.text).toBe('listo');
        const secondCallMessages = create.mock.calls[1][0].messages;
        const toolMsg = secondCallMessages.find((m: any) => m.role === 'tool');
        expect(toolMsg).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'contenido del archivo' });
    });

    it('gracefully handles malformed tool_call arguments instead of throwing', async () => {
        const create = vi.fn().mockResolvedValue({
            choices: [
                {
                    message: {
                        role: 'assistant',
                        content: null,
                        tool_calls: [{ id: 'call_x', type: 'function', function: { name: 'readFile', arguments: '{not json' } }]
                    }
                }
            ]
        });
        const fakeClient: OpenAiChatClient = { chat: { completions: { create } } };
        const provider = new OpenAiProvider('gpt-4o-mini', () => fakeClient);
        const chat = provider.createChat('sys', tools);

        const response = await chat.sendMessage({ kind: 'text', text: 'x' });
        expect(response.functionCalls).toEqual([{ id: 'call_x', name: 'readFile', args: {} }]);
    });
});
