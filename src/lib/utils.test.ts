import { fmt, toCsv } from "./utils";

describe("fmt", () => {
  it("formats distances and areas with Swedish separators", () => {
    expect(fmt.distance(850)).toBe("850 m");
    expect(fmt.distance(3561)).toBe("3,56 km");
    expect(fmt.distance(12_340)).toBe("12,3 km");
    expect(fmt.area(5000)).toBe("5000 m²");
    expect(fmt.area(782_000)).toBe("78,2 ha");
    expect(fmt.coord(null, 1)).toBe("–");
  });
});

describe("toCsv", () => {
  it("escapes values and starts with a UTF-8 BOM", () => {
    const csv = toCsv([{ a: "Älg, stor", b: 'say "hi"', c: null }]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"Älg, stor","say ""hi""",');
  });
});
