/**
 * @license SPDX-FileCopyrightText: © 2026 Zenme Pty Ltd <info@zenme.com.au>
 * @license SPDX-License-Identifier: MIT
 */

export function findIgnoreCase<T>(list: T[], getKey: (item: T) => string, value: string): T | undefined {
  const target = value.toLowerCase();
  return list.find((item) => getKey(item).toLowerCase() === target);
}
