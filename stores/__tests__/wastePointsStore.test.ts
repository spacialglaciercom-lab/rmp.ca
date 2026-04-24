import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

import { useWastePointsStore } from '../wastePointsStore';

const base = { lat: 45.0, lon: -73.0, type: 'bin' as const };

beforeEach(() => {
  useWastePointsStore.getState().clearAll();
});

describe('initial state', () => {
  it('starts with an empty points array', () => {
    expect(useWastePointsStore.getState().points).toEqual([]);
  });
});

describe('add', () => {
  it('inserts a point', () => {
    useWastePointsStore.getState().add(base);
    expect(useWastePointsStore.getState().points).toHaveLength(1);
  });

  it('generates a waste_* prefixed id', () => {
    useWastePointsStore.getState().add(base);
    expect(useWastePointsStore.getState().points[0].id).toMatch(/^waste_/);
  });

  it('assigns a createdAt ISO string', () => {
    useWastePointsStore.getState().add(base);
    const { createdAt } = useWastePointsStore.getState().points[0];
    expect(createdAt).toBeTruthy();
    expect(() => new Date(createdAt)).not.toThrow();
  });

  it('prepends the new point (newest first)', () => {
    useWastePointsStore.getState().add({ ...base, lat: 45.0 });
    useWastePointsStore.getState().add({ ...base, lat: 46.0 });
    expect(useWastePointsStore.getState().points[0].lat).toBe(46.0);
  });

  it('generates unique ids across multiple adds', () => {
    useWastePointsStore.getState().add(base);
    useWastePointsStore.getState().add(base);
    const ids = useWastePointsStore.getState().points.map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('preserves additional fields', () => {
    useWastePointsStore.getState().add({ ...base, address: '123 Main St', condition: 'good' });
    const p = useWastePointsStore.getState().points[0];
    expect(p.address).toBe('123 Main St');
    expect(p.condition).toBe('good');
  });
});

describe('addMany', () => {
  it('inserts all points', () => {
    useWastePointsStore.getState().addMany([base, { ...base, lat: 46 }]);
    expect(useWastePointsStore.getState().points).toHaveLength(2);
  });

  it('all points get generated ids', () => {
    useWastePointsStore.getState().addMany([base, base, base]);
    const ids = useWastePointsStore.getState().points.map((p) => p.id);
    expect(ids.every((id) => id.startsWith('waste_'))).toBe(true);
    expect(new Set(ids).size).toBe(3);
  });

  it('prepends new points before existing ones', () => {
    useWastePointsStore.getState().add({ ...base, lat: 1 });
    useWastePointsStore.getState().addMany([{ ...base, lat: 2 }, { ...base, lat: 3 }]);
    const lats = useWastePointsStore.getState().points.map((p) => p.lat);
    expect(lats[lats.length - 1]).toBe(1);
  });
});

describe('update', () => {
  it('patches the target point', () => {
    useWastePointsStore.getState().add(base);
    const id = useWastePointsStore.getState().points[0].id;
    useWastePointsStore.getState().update(id, { condition: 'overflowing' });
    expect(useWastePointsStore.getState().points[0].condition).toBe('overflowing');
  });

  it('leaves unchanged fields intact', () => {
    useWastePointsStore.getState().add({ ...base, address: 'Keep me' });
    const id = useWastePointsStore.getState().points[0].id;
    useWastePointsStore.getState().update(id, { condition: 'damaged' });
    expect(useWastePointsStore.getState().points[0].address).toBe('Keep me');
  });

  it('does not modify other points', () => {
    useWastePointsStore.getState().addMany([{ ...base, lat: 1 }, { ...base, lat: 2 }]);
    const [p1, p2] = useWastePointsStore.getState().points;
    useWastePointsStore.getState().update(p1.id, { condition: 'good' });
    expect(useWastePointsStore.getState().points.find((p) => p.id === p2.id)?.condition).toBeUndefined();
  });
});

describe('remove', () => {
  it('removes the point with the given id', () => {
    useWastePointsStore.getState().add(base);
    const { id } = useWastePointsStore.getState().points[0];
    useWastePointsStore.getState().remove(id);
    expect(useWastePointsStore.getState().points).toHaveLength(0);
  });

  it('leaves other points untouched', () => {
    useWastePointsStore.getState().addMany([base, base]);
    const [p1] = useWastePointsStore.getState().points;
    useWastePointsStore.getState().remove(p1.id);
    expect(useWastePointsStore.getState().points).toHaveLength(1);
  });

  it('is a no-op for a non-existent id', () => {
    useWastePointsStore.getState().add(base);
    useWastePointsStore.getState().remove('nonexistent');
    expect(useWastePointsStore.getState().points).toHaveLength(1);
  });
});

describe('setAll', () => {
  it('replaces all existing points', () => {
    useWastePointsStore.getState().addMany([base, base]);
    const replacement = [{ ...base, id: 'custom-id', createdAt: new Date().toISOString() }];
    useWastePointsStore.getState().setAll(replacement);
    expect(useWastePointsStore.getState().points).toEqual(replacement);
  });

  it('can clear all points by passing an empty array', () => {
    useWastePointsStore.getState().add(base);
    useWastePointsStore.getState().setAll([]);
    expect(useWastePointsStore.getState().points).toHaveLength(0);
  });
});

describe('clearAll', () => {
  it('empties the points array', () => {
    useWastePointsStore.getState().addMany([base, base, base]);
    useWastePointsStore.getState().clearAll();
    expect(useWastePointsStore.getState().points).toEqual([]);
  });
});
