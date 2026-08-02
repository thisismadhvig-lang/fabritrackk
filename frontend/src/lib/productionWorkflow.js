const parseDispatchNotes = (notes) => {
  if (!notes) return {};
  if (typeof notes === "object") return notes;
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export const getDispatchExpectedPieces = (dispatch = {}, fallback = {}) => {
  const noteData = parseDispatchNotes(dispatch?.notes);
  const directValue = Number(dispatch?.expected_pieces ?? dispatch?.expectedPieces ?? fallback?.expectedPieces ?? noteData?.expectedPieces ?? noteData?.expected_pieces ?? 0);
  if (Number.isFinite(directValue) && directValue > 0) {
    return directValue;
  }

  return 0;
};

export const getFabricStillLyingKg = (dispatch = {}, returnRow = {}) => {
  const expectedPieces = Number(getDispatchExpectedPieces(dispatch));
  const avgFabricPerPiece = Number(dispatch?.avg_fabric_per_piece ?? dispatch?.avgFabricPerPiece ?? 0);
  const piecesReceived = Number(returnRow?.pieces_received ?? 0);

  if (expectedPieces > 0 && avgFabricPerPiece > 0) {
    const lying = Math.max(expectedPieces - piecesReceived, 0) * avgFabricPerPiece;
    return Number.isFinite(lying) ? Number(lying.toFixed(3)) : 0;
  }

  const dispatched = Number(dispatch?.kg_dispatched ?? 0);
  const used = Number(returnRow?.kg_used ?? 0);
  const returned = Number(returnRow?.fabric_returned_kg ?? 0);
  const waste = Number(returnRow?.cutting_waste_kg ?? 0);
  const lying = Math.max(dispatched - used - returned - waste, 0);
  return Number.isFinite(lying) ? Number(lying.toFixed(3)) : 0;
};
