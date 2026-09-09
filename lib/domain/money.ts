import Decimal from 'decimal.js';

Decimal.set({ precision: 38, rounding: Decimal.ROUND_HALF_EVEN });

export type DecimalString = string & { readonly __decimalString: unique symbol };

const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function decimalString(value: string | number | Decimal): DecimalString {
  const input = String(value).trim();
  if (!DECIMAL_PATTERN.test(input)) throw new Error(`Invalid decimal value: ${input}`);
  return new Decimal(input).toFixed() as DecimalString;
}

export function decimalAdd(...values: DecimalString[]): DecimalString {
  return values.reduce((total, value) => total.plus(value), new Decimal(0)).toFixed() as DecimalString;
}

export function decimalMultiply(left: DecimalString, right: DecimalString): DecimalString {
  return new Decimal(left).times(right).toFixed() as DecimalString;
}

export function decimalToDisplayNumber(value: DecimalString): number {
  return new Decimal(value).toNumber();
}
