import { isValidRect, FractionRect } from './coords';

export function validateDemoTitle(title: string): string {
  const t = title.trim();
  if (!t) return 'Untitled demo';
  return t.slice(0, 120);
}

export function validateScreenName(name: string): string | null {
  const t = name.trim();
  if (!t) return null; // signal: revert
  return t.slice(0, 80);
}

export function validateImageType(type: string): boolean {
  return ['image/png', 'image/jpeg', 'image/webp'].includes(type);
}

export function validateImageSize(bytes: number): boolean {
  return bytes <= 10 * 1024 * 1024;
}

export function validateHotspotRect(r: FractionRect): boolean {
  return isValidRect(r);
}

export function validateAction(action: string): action is 'navigate' | 'tooltip' | 'layover' {
  return action === 'navigate' || action === 'tooltip' || action === 'layover';
}

export function validateTooltipText(text: string): boolean {
  return text.length <= 280;
}
