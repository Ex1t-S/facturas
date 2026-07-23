import { describe, expect, it } from 'vitest';
import { renderPreliminaryEngineeringSvg } from './drawing.js';
import { buildDeterministicEngineeringResult, enforcePreliminaryDrawingDisclosure } from './engineeringDeterministic.js';
import { activeInputs, parseConversationState, updateConversationState } from './conversationState.js';

describe('engineering preliminary drawing flow', () => {
  it('recognizes a natural request for a 200 t silo drawing', () => {
    const state = updateConversationState(parseConversationState(), 'Generá un plano orientativo para un silo aéreo de 200 t.');

    expect(state.projectType).toBe('SILO');
    expect(state.currentIntent).toBe('PRELIMINARY_DRAWING');
    expect(activeInputs(state).find((item) => item.key === 'capacity')?.value).toBe(200);
    expect(state.missingData.some((item) => item.key === 'diameter')).toBe(true);
  });

  it('offers a drawing even when geometry is incomplete', () => {
    const message = 'Necesito un plaano de un silo de 200 toneladas.';
    const state = updateConversationState(parseConversationState(), message);
    const result = buildDeterministicEngineeringResult({ state, message });

    expect(result.intent).toBe('PRELIMINARY_DRAWING');
    expect(result.nextAction).toEqual({ label: 'Generar plano orientativo', type: 'GENERATE_DRAWING' });
    expect(result.answer).toContain('valores ilustrativos');
    expect(result.warnings.join(' ')).toContain('No es apto para fabricación');
  });

  it('preserves the illustrative geometry disclosure when the model omits it', () => {
    const state = updateConversationState(parseConversationState(), 'Necesito un plaano de un silo de 200 toneladas.');
    const answer = enforcePreliminaryDrawingDisclosure('Puedo preparar la plantilla FMH.', state);

    expect(answer).toContain('valores ilustrativos');
    expect(answer).toContain('Ø 8 m');
    expect(answer).toContain('No son dimensiones calculadas');
  });

  it('renders the FMH drawing template with elevation, plan and assumptions', () => {
    const svg = renderPreliminaryEngineeringSvg({
      drawingType: 'SILO',
      diameter: 8,
      bodyHeight: 7,
      coneHeight: 2,
      freeHeight: 4,
      supportCount: 6,
      capacityT: 200,
      notes: ['Diámetro ilustrativo hasta confirmar geometría.']
    });

    expect(svg).toContain('ELEVACIÓN GENERAL');
    expect(svg).toContain('PLANTA DE APOYOS');
    expect(svg).toContain('200 t');
    expect(svg).toContain('6 APOYOS');
    expect(svg).toContain('NO APTO PARA FABRICACION');
    expect(svg).toContain('Diámetro ilustrativo');
  });
});
