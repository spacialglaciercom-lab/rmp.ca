import { describe, it, expect, beforeEach } from 'vitest';
import { useCircuitStore } from '../circuitStore';

const mockStreetEdge = {
  id: 'se1',
  from: 'nodeA',
  to: 'nodeB',
  coordinates: [[-73.0, 45.0], [-73.01, 45.01]] as [number, number][],
  length: 150,
  speed: 50,
  oneWay: false,
};

const mockTurnEdge = {
  id: 'te1',
  from: { edgeId: 'se1', direction: 'forward' as const, intersectionId: 'i1' },
  to: { edgeId: 'se1', direction: 'backward' as const, intersectionId: 'i2' },
  turnType: 'straight' as const,
  staticPenalty: 2,
  baseTime: 10,
};

beforeEach(() => {
  useCircuitStore.getState().clearCircuit();
});

describe('initial state', () => {
  it('circuit is an empty array', () => {
    expect(useCircuitStore.getState().circuit).toEqual([]);
  });

  it('streetEdges is an empty array', () => {
    expect(useCircuitStore.getState().streetEdges).toEqual([]);
  });
});

describe('setCircuit', () => {
  it('stores circuit and streetEdges', () => {
    useCircuitStore.getState().setCircuit([mockTurnEdge], [mockStreetEdge]);
    const { circuit, streetEdges } = useCircuitStore.getState();
    expect(circuit).toEqual([mockTurnEdge]);
    expect(streetEdges).toEqual([mockStreetEdge]);
  });

  it('replaces previously stored data', () => {
    useCircuitStore.getState().setCircuit([mockTurnEdge], [mockStreetEdge]);
    useCircuitStore.getState().setCircuit([], []);
    expect(useCircuitStore.getState().circuit).toEqual([]);
    expect(useCircuitStore.getState().streetEdges).toEqual([]);
  });

  it('stores multiple edges', () => {
    const edges = [mockTurnEdge, { ...mockTurnEdge, id: 'te2' }];
    useCircuitStore.getState().setCircuit(edges, [mockStreetEdge]);
    expect(useCircuitStore.getState().circuit).toHaveLength(2);
  });
});

describe('clearCircuit', () => {
  it('resets circuit to empty', () => {
    useCircuitStore.getState().setCircuit([mockTurnEdge], [mockStreetEdge]);
    useCircuitStore.getState().clearCircuit();
    expect(useCircuitStore.getState().circuit).toEqual([]);
  });

  it('resets streetEdges to empty', () => {
    useCircuitStore.getState().setCircuit([mockTurnEdge], [mockStreetEdge]);
    useCircuitStore.getState().clearCircuit();
    expect(useCircuitStore.getState().streetEdges).toEqual([]);
  });
});
