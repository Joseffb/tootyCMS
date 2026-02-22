export function singularizeLabel(input: string): string {
  const value = input.trim();
  const lower = value.toLowerCase();

  if (lower.endsWith("ies") && lower.length > 3) {
    return `${value.slice(0, -3)}y`;
  }

  const esSuffixes = ["ches", "shes", "sses", "xes", "zes"];
  if (esSuffixes.some((suffix) => lower.endsWith(suffix)) && lower.length > 4) {
    return value.slice(0, -2);
  }

  if (lower.endsWith("s") && !lower.endsWith("ss") && lower.length > 1) {
    return value.slice(0, -1);
  }

  return value;
}

export function pluralizeLabel(input: string): string {
  const value = input.trim();
  if (!value) return value;

  const lower = value.toLowerCase();
  if (lower.endsWith("ies")) return value;

  if (/[^aeiou]y$/i.test(value)) {
    return `${value.slice(0, -1)}ies`;
  }

  if (/(s|x|z|ch|sh)$/i.test(value)) {
    return `${value}es`;
  }

  if (lower.endsWith("s")) return value;
  return `${value}s`;
}
