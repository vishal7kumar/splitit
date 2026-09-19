import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  getCurrencySymbol,
  formatIndianNumber,
} from "./currency";

describe("currency utility", () => {
  describe("getCurrencySymbol", () => {
    it("returns ₹ for INR and RS (case insensitive)", () => {
      expect(getCurrencySymbol("INR")).toBe("₹");
      expect(getCurrencySymbol("inr")).toBe("₹");
      expect(getCurrencySymbol("Rs")).toBe("₹");
      expect(getCurrencySymbol("RS")).toBe("₹");
      expect(getCurrencySymbol("rs")).toBe("₹");
    });

    it("returns correct symbols for USD, EUR, GBP", () => {
      expect(getCurrencySymbol("USD")).toBe("$");
      expect(getCurrencySymbol("EUR")).toBe("€");
      expect(getCurrencySymbol("GBP")).toBe("£");
    });

    it("falls back to the code itself when unknown", () => {
      expect(getCurrencySymbol("XYZ")).toBe("XYZ");
    });
  });

  describe("formatIndianNumber", () => {
    it("formats amounts using the Indian numbering grouping (lakhs and crores)", () => {
      expect(formatIndianNumber(0)).toBe("0.00");
      expect(formatIndianNumber(100)).toBe("100.00");
      expect(formatIndianNumber(1234.56)).toBe("1,234.56");
      expect(formatIndianNumber(1564464)).toBe("15,64,464.00");
      expect(formatIndianNumber(10000000)).toBe("1,00,00,000.00");
      expect(formatIndianNumber(-1564464)).toBe("-15,64,464.00");
    });
  });

  describe("formatCurrency", () => {
    it("formats INR and Rs with Indian numbering system (e.g. ₹15,64,464.00 instead of ₹1,564,464.00)", () => {
      expect(formatCurrency("INR", 1564464)).toBe("₹15,64,464.00");
      expect(formatCurrency("Rs", 1564464)).toBe("₹15,64,464.00");
      expect(formatCurrency("RS", 1564464)).toBe("₹15,64,464.00");
      expect(formatCurrency("rs", 1564464)).toBe("₹15,64,464.00");
    });

    it("formats zero and standard INR amounts properly", () => {
      expect(formatCurrency("INR", 0)).toBe("₹0.00");
      expect(formatCurrency("INR", 100)).toBe("₹100.00");
      expect(formatCurrency("INR", 1234.56)).toBe("₹1,234.56");
      expect(formatCurrency("Rs", 50)).toBe("₹50.00");
    });

    it("formats negative amounts with Indian numbering system", () => {
      expect(formatCurrency("INR", -1564464)).toBe("-₹15,64,464.00");
      expect(formatCurrency("Rs", -1564464)).toBe("-₹15,64,464.00");
    });

    it("formats other currencies with standard international comma separation", () => {
      expect(formatCurrency("USD", 1564464)).toBe("$1,564,464.00");
      expect(formatCurrency("EUR", 1564464)).toBe("€1,564,464.00");
      expect(formatCurrency("GBP", 1564464)).toBe("£1,564,464.00");
    });

    it("gracefully handles unknown currency codes in fallback", () => {
      expect(formatCurrency("UNKNOWN", 1000)).toBe("UNKNOWN1000.00");
    });
  });
});
