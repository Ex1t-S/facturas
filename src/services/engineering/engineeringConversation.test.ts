import { describe, expect, it } from 'vitest';
import { buildDeterministicEngineeringResult } from './engineeringDeterministic.js';
import { classifyEngineeringIntent, extractEngineeringFacts, normalizeEngineeringText } from './engineeringIntelligence.js';
import { parseConversationState, updateConversationState } from './conversationState.js';
import { requiredToolForEngineeringIntent, runEngineeringOrchestrator } from './engineeringConversation.js';
import { parseOptionalBoolean } from './queryParsing.js';
import { engineeringToolDefinitions } from './engineeringTools.js';
import { engineeringHistoryItem, extractEngineeringResponseText } from './engineeringRuntime.js';

describe('engineering conversational flow', () => {
  it('normalizes common mojibake without losing accents', () => {
    expect(normalizeEngineeringText('silo aÃ©reo de maÃ­z')).toBe('silo aéreo de maíz');
  });

  it('classifies a direct support-load question without requiring a full design brief', () => {
    expect(classifyEngineeringIntent('Tengo un silo de 200 toneladas y 20 patas. ¿Qué carga toma cada una?').intent).toBe('LOAD_PER_SUPPORT');
  });

  it('extracts natural Spanish structural facts', () => {
    const facts = extractEngineeringFacts('Silo de 200 t, 20 patas, 4 metros libres, caño 150x150x6,35 y barras de 12 m.');
    expect(facts.find((fact) => fact.key === 'capacity')?.value).toBe(200);
    expect(facts.find((fact) => fact.key === 'supportCount')?.value).toBe(20);
    expect(facts.find((fact) => fact.key === 'freeHeight')?.value).toBe(4);
    expect(facts.find((fact) => fact.key === 'sectionThickness')?.value).toBe(6.35);
    expect(facts.find((fact) => fact.key === 'commercialLength')?.value).toBe(12);
  });

  it('answers 200 t over 20 supports directly in local deterministic mode', () => {
    let state = parseConversationState();
    state = updateConversationState(state, 'Tengo un silo de 200 toneladas y 20 patas. ¿Qué carga toma cada una?');
    const result = buildDeterministicEngineeringResult({ state, message: 'Tengo un silo de 200 toneladas y 20 patas. ¿Qué carga toma cada una?' });
    expect(result.intent).toBe('LOAD_PER_SUPPORT');
    expect(result.answer).toContain('98,1');
    expect(result.missingData).toHaveLength(0);
    expect(result.provider).toBe('local');
  });

  it('does not carry silo intent into a new sheet-cutting question', () => {
    let state = parseConversationState();
    state = updateConversationState(state, 'Hablemos de un silo de 200 toneladas.');
    state = updateConversationState(state, 'Pasame cómo cortar una chapa de 1,5 x 3 metros.');
    expect(state.currentIntent).toBe('MATERIAL_TAKEOFF');
    expect(buildDeterministicEngineeringResult({ state, message: 'Pasame cómo cortar una chapa de 1,5 x 3 metros.' }).answer).toContain('chapa');
  });

  it('compares two explicit hollow sections using their geometry', () => {
    let state = parseConversationState();
    state = updateConversationState(state, 'Compará un tubo 150x150x4,75 contra uno 150x150x6,35.');
    const result = buildDeterministicEngineeringResult({ state, message: 'Compará un tubo 150x150x4,75 contra uno 150x150x6,35.' });
    expect(result.intent).toBe('SECTION_COMPARISON');
    expect(result.answer).toContain('150x150');
    expect(result.calculations.length).toBeGreaterThan(0);
  });

  it('exposes an explicit OpenAI failure and keeps a useful deterministic fallback', async () => {
    const result = await runEngineeringOrchestrator({ companyId: 'test-company', message: 'Tengo un silo de 200 toneladas y 20 patas. ¿Qué carga toma cada una?' });
    expect(result.execution.provider).toBe('openai');
    expect(result.execution.success).toBe(false);
    expect(result.execution.error?.code).toBe('MISSING_OPENAI_API_KEY');
    expect(result.result.provider).toBe('local');
    expect(result.result.fallbackUsed).toBe(true);
    expect(result.result.answer).toContain('98,1');
  });

  it('parses the verified filter without turning false into true', () => {
    expect(parseOptionalBoolean('true')).toBe(true);
    expect(parseOptionalBoolean('false')).toBe(false);
    expect(parseOptionalBoolean(true)).toBe(true);
    expect(parseOptionalBoolean(false)).toBe(false);
    expect(parseOptionalBoolean(undefined)).toBeUndefined();
  });

  it('exposes OpenAI-compatible tool schemas when parameters are optional', () => {
    expect(engineeringToolDefinitions.length).toBeGreaterThan(10);
    expect(engineeringToolDefinitions.every((tool) => tool.strict === false)).toBe(true);
  });

  it('extracts text from the raw Responses API output shape', () => {
    expect(extractEngineeringResponseText({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK FMH' }] }] })).toBe('OK FMH');
  });

  it('uses the Responses API content type required for assistant history', () => {
    expect(engineeringHistoryItem({ role: 'assistant', content: 'Respuesta anterior' }).content[0].type).toBe('output_text');
    expect(engineeringHistoryItem({ role: 'user', content: 'Consulta nueva' }).content[0].type).toBe('input_text');
  });

  it('keeps a pending load-per-support intent when the user supplies the requested values', () => {
    expect(classifyEngineeringIntent('Tengo 200 toneladas y 20 patas.', { currentIntent: 'LOAD_PER_SUPPORT' }).intent).toBe('LOAD_PER_SUPPORT');
  });

  it('requires the deterministic support-load tool for a complete support calculation', () => {
    expect(requiredToolForEngineeringIntent('LOAD_PER_SUPPORT')).toBe('calculate_load_per_support');
  });
});
