/** Editable values and labels use no more than two decimal places. */
export function round2(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

/** Upper bounds round inward, so quantization never crosses the page edge. */
export function floor2(value: number): number {
  return Math.floor((value + Number.EPSILON) * 100) / 100;
}

export function numberDraft(value: string, previous: string): string {
  return /^-?\d*(?:\.\d{0,2})?$/.test(value) ? value : previous;
}

export function parseNumberDraft(value: string): number | null {
  if(!/^-?(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(value))return null;
  const number=Number(value);return Number.isFinite(number)?round2(number):null;
}
