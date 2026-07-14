export type LinearPiece = { lengthM: number; quantity: number };

export type CuttingBar = {
  cutsM: number[];
  usedM: number;
  wasteM: number;
};

export function optimizeLinearCuts(pieces: LinearPiece[], commercialLengthM: number): CuttingBar[] {
  if (!Number.isFinite(commercialLengthM) || commercialLengthM <= 0) throw new Error('La longitud comercial debe ser mayor que cero.');
  const expanded = pieces.flatMap((piece) => {
    if (!Number.isFinite(piece.lengthM) || piece.lengthM <= 0 || !Number.isInteger(piece.quantity) || piece.quantity < 0) throw new Error('Las piezas deben tener longitud positiva y cantidad entera.');
    if (piece.lengthM > commercialLengthM) throw new Error('Una pieza supera la longitud comercial disponible.');
    return Array.from({ length: piece.quantity }, () => piece.lengthM);
  }).sort((left, right) => right - left);
  const bars: Array<{ cutsM: number[]; remainingM: number }> = [];
  for (const lengthM of expanded) {
    const target = bars.find((bar) => bar.remainingM + 1e-9 >= lengthM);
    if (target) {
      target.cutsM.push(lengthM);
      target.remainingM -= lengthM;
    } else bars.push({ cutsM: [lengthM], remainingM: commercialLengthM - lengthM });
  }
  return bars.map((bar) => ({ cutsM: bar.cutsM, usedM: commercialLengthM - bar.remainingM, wasteM: bar.remainingM }));
}
