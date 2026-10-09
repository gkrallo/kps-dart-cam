import { describe, it, expect } from 'vitest';
import { createMatch, serializeMatch, throwDart } from '../../game/match';
import {
  decodeMessage,
  encodeMessage,
  isValidSeg,
  parseWireMessage,
  type WireMessage,
} from '../protocol';

const match = createMatch({ mode: '501', players: [{ name: 'Anna' }, { name: 'Bo' }] });
throwDart(match, { v: 20, m: 3 });
const ser = serializeMatch(match);

const base = { v: 1 as const, matchId: match.id };

const ALL: WireMessage[] = [
  { ...base, type: 'hello', clientId: 'c1', knownVersion: -1 },
  { ...base, type: 'snapshot', version: 7, match: ser, acked: ['p1', 'p2'] },
  { ...base, matchId: '', type: 'snapshot', version: 8, match: null, acked: [] },
  { ...base, type: 'propose', proposalId: 'p1', baseVersion: 7, op: { kind: 'throw', seg: { v: 25, m: 2 } } },
  { ...base, type: 'propose', proposalId: 'p2', baseVersion: 7, op: { kind: 'replace', actionIndex: 0, seg: { v: 5, m: 1 } } },
  { ...base, type: 'propose', proposalId: 'p3', baseVersion: 7, op: { kind: 'insert', actionIndex: 1, seg: { v: 0, m: 1 } } },
  { ...base, type: 'propose', proposalId: 'p4', baseVersion: 7, op: { kind: 'remove', actionIndex: 0 } },
  { ...base, type: 'propose', proposalId: 'p5', baseVersion: 7, op: { kind: 'undo' } },
  { ...base, type: 'propose', proposalId: 'p6', baseVersion: 7, op: { kind: 'endTurn' } },
  { ...base, type: 'reject', proposalId: 'p1', reason: 'Matchen ändrades - försök igen' },
  { ...base, type: 'ping', t: 123.5 },
  { ...base, type: 'pong', t: 123.5 },
  {
    ...base,
    type: 'frame',
    frameId: 'f1',
    version: 7,
    actionIndex: 0,
    jpegBase64: 'AAAA',
    crop: { x: 10, y: 20, w: 300, h: 300 },
    tipPx: { x: 150, y: 140 },
  },
];

describe('protokollet', () => {
  it('varje meddelandetyp överlever en rundgång genom JSON', () => {
    for (const msg of ALL) {
      expect(decodeMessage(encodeMessage(msg))).toEqual(msg);
    }
  });

  it('täcker alla typer', () => {
    const types = new Set(ALL.map((m) => m.type));
    expect([...types].sort()).toEqual(['frame', 'hello', 'ping', 'pong', 'propose', 'reject', 'snapshot']);
  });

  it('fel protokollversion, okänd typ och trasig JSON ger null, inte ett undantag', () => {
    expect(parseWireMessage({ ...ALL[0], v: 2 })).toBeNull();
    expect(parseWireMessage({ ...base, type: 'resync', fromSeq: 1 })).toBeNull();
    expect(parseWireMessage(null)).toBeNull();
    expect(parseWireMessage('hello')).toBeNull();
    expect(decodeMessage('{inte json')).toBeNull();
    expect(parseWireMessage({ ...ALL[0], matchId: undefined })).toBeNull();
  });

  it('förslag med påhittade fält eller trasiga index avvisas redan vid tolkningen', () => {
    const p = (op: unknown) =>
      parseWireMessage({ ...base, type: 'propose', proposalId: 'x', baseVersion: 1, op });
    expect(p({ kind: 'throw', seg: { v: 19, m: 7 } })).toBeNull();
    expect(p({ kind: 'throw', seg: { v: 25, m: 3 } })).toBeNull();
    expect(p({ kind: 'throw', seg: { v: 0, m: 2 } })).toBeNull();
    expect(p({ kind: 'replace', actionIndex: 1.5, seg: { v: 1, m: 1 } })).toBeNull();
    expect(p({ kind: 'remove' })).toBeNull();
    expect(p({ kind: 'restartLeg' })).toBeNull();
  });

  it('giltiga fält', () => {
    expect(isValidSeg({ v: 0, m: 1 })).toBe(true);
    expect(isValidSeg({ v: 20, m: 3 })).toBe(true);
    expect(isValidSeg({ v: 25, m: 2 })).toBe(true);
    expect(isValidSeg({ v: 21, m: 1 })).toBe(false);
    expect(isValidSeg({ v: 5, m: 0 })).toBe(false);
  });
});
