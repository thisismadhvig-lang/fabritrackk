import { getDispatchExpectedPieces, getFabricStillLyingKg } from "./productionWorkflow";

describe("production workflow helpers", () => {
  it("uses the saved expected pieces value from dispatch metadata", () => {
    expect(getDispatchExpectedPieces({ expected_pieces: 42 })).toBe(42);
    expect(getDispatchExpectedPieces({ expected_pieces: 0, kg_dispatched: 10 }, { expectedPieces: 0 })).toBe(0);
  });

  it("calculates fabric still lying from expected pieces and avg fabric per piece when provided", () => {
    expect(getFabricStillLyingKg({ expected_pieces: 4200, avg_fabric_per_piece: 0.043 }, { pieces_received: 1000 })).toBe(137.6);
    expect(getFabricStillLyingKg({ expected_pieces: 0, avg_fabric_per_piece: 0.043 }, { pieces_received: 1000 })).toBe(0);
  });

  it("falls back to the dispatched fabric rule when no expected-piece inputs are available", () => {
    expect(getFabricStillLyingKg({ kg_dispatched: 100 }, { kg_used: 40, fabric_returned_kg: 20, cutting_waste_kg: 10 })).toBe(30);
    expect(getFabricStillLyingKg({ kg_dispatched: 0 }, { kg_used: 5 })).toBe(0);
  });
});
