import { describe, expect, it } from "vitest";
import { answerTags, mergeTags } from "../templates/agents/lib/offers/capture-tags";

describe("offer capture answer tags", () => {
  it("turns zero-party answers into mos-ans:<key>:<value> tags", () => {
    expect(answerTags({ room: "living", life_stage: "puppy" })).toEqual(["mos-ans:room:living", "mos-ans:life_stage:puppy"]);
  });

  it("sanitises untrusted keys and values — no commas, no free text", () => {
    expect(answerTags({ "Room Type": "Living, Room!", "x-y": "A_b-C" })).toEqual([
      "mos-ans:roomtype:livingroom",
      "mos-ans:x_y:a_b-c",
    ]);
    expect(answerTags({ room: "a".repeat(80) })[0]).toBe(`mos-ans:room:${"a".repeat(32)}`);
  });

  it("drops empty or non-string answers and non-object payloads", () => {
    expect(answerTags({ room: "", "": "x", n: 3, o: { a: 1 }, "!!": "living" })).toEqual([]);
    expect(answerTags(null)).toEqual([]);
    expect(answerTags(["room", "living"])).toEqual([]);
    expect(answerTags("room=living")).toEqual([]);
  });

  it("caps at five tags", () => {
    const answers = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`k${i}`, "v"]));
    expect(answerTags(answers)).toHaveLength(5);
  });

  it("merges into existing tags without duplicates", () => {
    expect(mergeTags("vip, mos-ans:room:living", ["mos-ans:room:living", "mos-ans:size:large"])).toBe(
      "vip,mos-ans:room:living,mos-ans:size:large",
    );
    expect(mergeTags(undefined, ["a"])).toBe("a");
  });
});
