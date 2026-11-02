import { render, screen } from "@testing-library/react";
import { Field, Input, Select } from "./form";

describe("Field", () => {
  it("associates its label with a single control", () => {
    render(<Field label="Team name" hint="Shown to members"><Input /></Field>);
    const input = screen.getByLabelText("Team name");
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAccessibleDescription("Shown to members");
  });
  it("keeps an explicit id", () => {
    render(<Field label="Role"><Select id="role"><option>a</option></Select></Field>);
    expect(screen.getByLabelText("Role").id).toBe("role");
  });
  it("does not label composite children", () => {
    render(<Field label="Location"><div><Input aria-label="Latitude" /></div></Field>);
    expect(screen.queryByLabelText("Location")).toBeNull();
    expect(screen.getByLabelText("Latitude")).toBeInTheDocument();
  });
  it("announces errors", () => {
    render(<Field label="Email" error="Invalid"><Input /></Field>);
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid");
  });
});
